// MCP stdio server. ESM-only — no require().
// Tools: get_context, get_constraints, get_patterns, get_decisions, query_brain, log_event

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';   // ESM import — no require()
import { NohupMdWriter } from './NohupMdWriter.js';
import { EvidenceGate } from './EvidenceGate.js';

interface McpRequest  { jsonrpc: '2.0'; id: string | number; method: string; params?: Record<string, unknown>; }
interface McpResponse { jsonrpc: '2.0'; id: string | number; result?: unknown; error?: { code: number; message: string }; }

const TOOLS = [
  { name: 'get_context',    description: 'Return full NOHUP.md. Call this at session start.', inputSchema: { type: 'object', properties: {}, required: [] } },
  { name: 'get_constraints',description: 'Return locked user constraints.',                    inputSchema: { type: 'object', properties: {}, required: [] } },
  { name: 'get_patterns',   description: 'Return known failure patterns to avoid.',            inputSchema: { type: 'object', properties: {}, required: [] } },
  { name: 'get_decisions',  description: 'Return architectural decisions from past sessions.', inputSchema: { type: 'object', properties: {}, required: [] } },
  { name: 'query_brain',    description: 'Search compiled items for a keyword.',
    inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } },
  { name: 'log_event',      description: 'Manually log a high-salience event.',
    inputSchema: { type: 'object', properties: {
      content:  { type: 'string' },
      category: { type: 'string', enum: ['constraint', 'decision', 'pattern', 'context'] },
    }, required: ['content', 'category'] } },
];

export class McpServer {
  private writer: NohupMdWriter;
  private gate:   EvidenceGate;

  constructor(private projectRoot: string) {
    this.writer = new NohupMdWriter(projectRoot);
    this.gate   = new EvidenceGate(projectRoot);
  }

  serve(): void {
    console.error('[memento-mcp] Serving on stdio');
    process.stdin.setEncoding('utf-8');
    let buffer = '';
    process.stdin.on('data', (chunk: string) => {
      buffer += chunk;
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const req: McpRequest = JSON.parse(line);
          const res             = this.handle(req);
          process.stdout.write(JSON.stringify(res) + '\n');
        } catch (err) {
          process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: 0, error: { code: -32700, message: String(err) } }) + '\n');
        }
      }
    });
  }

  private handle(req: McpRequest): McpResponse {
    try   { return { jsonrpc: '2.0', id: req.id, result: this.dispatch(req) }; }
    catch (err) { return { jsonrpc: '2.0', id: req.id, error: { code: -32603, message: String(err) } }; }
  }

  private dispatch(req: McpRequest): unknown {
    switch (req.method) {
      case 'initialize': return { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'memento', version: '1.0.0' } };
      case 'tools/list': return { tools: TOOLS };
      case 'tools/call': return this.callTool(req.params?.name as string, (req.params?.arguments ?? {}) as Record<string, unknown>);
      default:           throw new Error(`Unknown method: ${req.method}`);
    }
  }

  private callTool(name: string, args: Record<string, unknown>): unknown {
    const nohupPath = join(this.projectRoot, 'NOHUP.md');
    const text = (t: string) => ({ content: [{ type: 'text', text: t }] });

    switch (name) {
      case 'get_context':     return text(existsSync(nohupPath) ? readFileSync(nohupPath, 'utf-8') : 'No NOHUP.md. Run: pocket-t init && pocket-t run --memento');
      case 'get_constraints': return text(this.writer.getItems().filter(i => i.category === 'constraint' && i.locked).map(i => `[${i.id}] ${i.content}`).join('\n') || 'No locked constraints yet.');
      case 'get_patterns':    return text(this.writer.getItems().filter(i => i.category === 'pattern').map(i => `[${i.id}] (w:${i.weight.toFixed(2)}) ${i.content}`).join('\n') || 'No patterns yet.');
      case 'get_decisions':   return text(this.writer.getItems().filter(i => i.category === 'decision').map(i => `[${i.id}] ${i.content}`).join('\n') || 'No decisions yet.');
      case 'query_brain': {
        const q = (args.query as string ?? '').toLowerCase();
        return text(this.writer.getItems().filter(i => i.content.toLowerCase().includes(q)).map(i => `[${i.id}] ${i.category}: ${i.content}`).join('\n') || `No results for "${q}".`);
      }
      case 'log_event': {
        const content  = args.content as string;
        const category = args.category as string;
        const hash     = createHash('sha256').update(content).digest('hex').slice(0, 8);
        const record   = { patternHash: hash, count: 1, firstSeen: new Date().toISOString(),
          lastSeen: new Date().toISOString(), type: 'manual', examples: [content],
          promoted: true, retrievalCount: 0, lastRetrieved: null };
        this.writer.addOrUpdateItem(record as any, content, category as any, 0.85, false);
        this.writer.write();
        return text(`Logged [${hash}]: ${content.slice(0, 60)}`);
      }
      default: throw new Error(`Unknown tool: ${name}`);
    }
  }
}
