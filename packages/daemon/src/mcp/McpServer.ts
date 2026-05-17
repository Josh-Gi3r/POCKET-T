import { createInterface } from 'node:readline';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PtyHost } from '../pty/PtyHost.js';
import type { RelayClient } from '../uplink/RelayClient.js';

// MCP protocol types (JSON-RPC 2.0 over stdio)
interface McpRequest {
  jsonrpc: '2.0';
  id:      string | number;
  method:  string;
  params?: unknown;
}

interface McpResponse {
  jsonrpc: '2.0';
  id:      string | number;
  result?: unknown;
  error?:  { code: number; message: string; data?: unknown };
}

interface McpNotification {
  jsonrpc: '2.0';
  method:  string;
  params?: unknown;
}

type McpMessage = McpRequest | McpNotification;

const TOOLS = [
  {
    name:        'list_sessions',
    description: 'List all running and recent terminal sessions on this Mac.',
    inputSchema: {
      type: 'object',
      properties: {
        status: {
          type:        'string',
          enum:        ['running', 'waiting', 'idle', 'dead', 'all'],
          description: 'Filter sessions by status. Default: all.',
        },
      },
    },
  },
  {
    name:        'get_session_output',
    description: 'Get recent output from a terminal session.',
    inputSchema: {
      type:     'object',
      required: ['sessionId'],
      properties: {
        sessionId: { type: 'string', description: 'Session ID from list_sessions.' },
        lines:     { type: 'number', description: 'Number of recent lines. Default: 50.' },
      },
    },
  },
  {
    name:        'send_input',
    description: 'Send text input to a terminal session (as if typed by the user).',
    inputSchema: {
      type:     'object',
      required: ['sessionId', 'text'],
      properties: {
        sessionId: { type: 'string' },
        text:      { type: 'string', description: 'Text to send. Append \\n to simulate Enter.' },
      },
    },
  },
  {
    name:        'spawn_session',
    description: 'Start a new terminal session on the Mac.',
    inputSchema: {
      type:     'object',
      required: ['cmd'],
      properties: {
        cmd:  { type: 'string', description: 'Command to run, e.g. "claude --dangerously-skip-permissions".' },
        name: { type: 'string', description: 'Display name for the session.' },
        cwd:  { type: 'string', description: 'Working directory. Defaults to home directory.' },
      },
    },
  },
  {
    name:        'kill_session',
    description: 'Kill a running terminal session.',
    inputSchema: {
      type:     'object',
      required: ['sessionId'],
      properties: {
        sessionId: { type: 'string' },
        signal:    { type: 'string', description: 'Signal to send. Default: SIGTERM.' },
      },
    },
  },
  {
    name:        'get_project_memory',
    description: 'Get the NOHUP.md memory document for the current project. Contains constraints, patterns, and session history extracted from past Claude Code sessions.',
    inputSchema: {
      type: 'object',
      properties: {
        projectRoot: {
          type:        'string',
          description: 'Project directory. Defaults to current working directory.',
        },
      },
    },
  },
  {
    name:        'approve_tool_call',
    description: 'Approve or deny a pending tool call approval. Use list_sessions to find sessions with status "waiting".',
    inputSchema: {
      type:     'object',
      required: ['approvalId', 'decision'],
      properties: {
        approvalId: { type: 'string' },
        decision:   { type: 'string', enum: ['approve', 'deny'] },
      },
    },
  },
];

export class McpServer {
  private rl: ReturnType<typeof createInterface>;
  private outputBuffer: string[] = [];

  constructor(
    private host:        PtyHost,
    private relayClient: RelayClient,
    private hookServer?: import('../hooks/HookServer.js').HookServer,
  ) {
    this.rl = createInterface({
      input:  process.stdin,
      output: process.stderr,  // stderr for debug, stdout reserved for MCP
      terminal: false,
    });
  }

  start() {
    console.error('[mcp] MCP server started on stdio');

    this.rl.on('line', (line) => {
      if (!line.trim()) return;
      try {
        const msg = JSON.parse(line) as McpMessage;
        this.handleMessage(msg);
      } catch (err) {
        console.error('[mcp] Parse error:', err);
      }
    });

    this.rl.on('close', () => {
      console.error('[mcp] stdin closed, exiting');
      process.exit(0);
    });

    // Send capabilities announcement
    this.send({
      jsonrpc: '2.0',
      method:  'notifications/initialized',
      params:  {},
    });
  }

  private async handleMessage(msg: McpMessage) {
    if (!('id' in msg)) {
      // Notification — no response needed
      return;
    }

    const req = msg as McpRequest;

    try {
      const result = await this.dispatch(req);
      this.send({ jsonrpc: '2.0', id: req.id, result });
    } catch (err: any) {
      this.send({
        jsonrpc: '2.0',
        id:      req.id,
        error:   { code: -32000, message: err.message ?? 'Internal error' },
      });
    }
  }

  private async dispatch(req: McpRequest): Promise<unknown> {
    const params = (req.params ?? {}) as any;

    switch (req.method) {

      case 'initialize':
        return {
          protocolVersion: '2024-11-05',
          capabilities:    { tools: {} },
          serverInfo:      { name: 'pocket-t', version: '1.0.0' },
        };

      case 'tools/list':
        return { tools: TOOLS };

      case 'tools/call': {
        const { name, arguments: args = {} } = params as {
          name:       string;
          arguments?: Record<string, unknown>;
        };
        return { content: await this.callTool(name, args) };
      }

      case 'ping':
        return {};

      default:
        throw new Error(`Unknown method: ${req.method}`);
    }
  }

  private async callTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<Array<{ type: 'text'; text: string }>> {

    const text = (t: string) => [{ type: 'text' as const, text: t }];

    switch (name) {

      case 'list_sessions': {
        const filter = (args.status ?? 'all') as string;
        let sessions = this.host.allMeta();
        if (filter !== 'all') {
          sessions = sessions.filter((s) => s.status === filter);
        }
        if (sessions.length === 0) {
          return text('No sessions found.');
        }
        const lines = sessions.map((s) =>
          `[${s.id.slice(0, 8)}] ${s.name} (${s.status})\n  cmd: ${s.cmd}\n  cwd: ${s.cwd}`
        );
        return text(lines.join('\n\n'));
      }

      case 'get_session_output': {
        const { sessionId, lines = 50 } = args as {
          sessionId: string;
          lines?:    number;
        };
        const session = this.host.get(sessionId);
        if (!session) return text(`Session ${sessionId} not found.`);

        const snap = session.snapshot();
        const output = snap.plainText
          .split('\n')
          .slice(-(lines as number))
          .join('\n');

        return text(output || '(no output)');
      }

      case 'send_input': {
        const { sessionId, text: input } = args as {
          sessionId: string;
          text:      string;
        };
        this.host.write(sessionId, input);
        return text(`Input sent to session ${sessionId}.`);
      }

      case 'spawn_session': {
        const { cmd, name = cmd.split(' ')[0], cwd = process.env.HOME ?? '~' } = args as {
          cmd:   string;
          name?: string;
          cwd?:  string;
        };
        const session = this.host.spawn(name as string, cmd, cwd as string);
        return text(
          `Session spawned.\nID: ${session.id}\nName: ${session.name}\nPID: ${session.pid}`
        );
      }

      case 'kill_session': {
        const { sessionId, signal = 'SIGTERM' } = args as {
          sessionId: string;
          signal?:   string;
        };
        this.host.kill(sessionId, signal as string);
        return text(`Session ${sessionId} killed.`);
      }

      case 'get_project_memory': {
        const projectRoot = (args.projectRoot as string) ?? process.cwd();
        const nohupPath   = join(projectRoot, 'NOHUP.md');
        if (!existsSync(nohupPath)) {
          return text(
            `No NOHUP.md found in ${projectRoot}.\n` +
            `Run pocket-t with --memento to enable memory for this project.`
          );
        }
        const content = readFileSync(nohupPath, 'utf-8');
        return text(content);
      }

      case 'approve_tool_call': {
        const { approvalId, decision } = args as {
          approvalId: string;
          decision:   'approve' | 'deny';
        };
        if (!this.hookServer) {
          return text('HookServer not running. Start daemon with approval hooks enabled.');
        }
        const resolved = this.hookServer.resolveApproval(approvalId, decision);
        if (!resolved) {
          return text(`Approval ${approvalId} not found or already resolved.`);
        }
        return text(`Tool call ${decision}d.`);
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }

  private send(msg: McpResponse | McpNotification) {
    process.stdout.write(JSON.stringify(msg) + '\n');
  }
}
