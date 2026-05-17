import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';
import { getSocket } from '../socket.js';

const QUICK = [
  { label: 'Claude Code',  cmd: 'claude',       icon: '🤖' },
  { label: 'Codex',        cmd: 'codex',        icon: '⚡' },
  { label: 'Aider',        cmd: 'aider',        icon: '🛠' },
  { label: 'Python REPL',  cmd: 'python3',      icon: '🐍' },
  { label: 'Node REPL',    cmd: 'node',         icon: '📦' },
  { label: 'Bash',         cmd: 'bash',         icon: '🐚' },
];

export function SpawnPage() {
  const navigate     = useNavigate();
  const [name, setName]   = useState('');
  const [cmd, setCmd]     = useState('');
  const [cwd, setCwd]     = useState('~');

  function spawn() {
    if (!cmd.trim()) return;
    getSocket().emit('client:session:spawn', {
      name: name.trim() || cmd.split(' ')[0],
      cmd:  cmd.trim(),
      cwd:  cwd.trim() || '~',
    });
    navigate('/');
  }

  return (
    <div className="flex flex-col h-screen bg-surface">
      <header className="flex items-center gap-3 px-4 pt-safe pb-3 pt-3 border-b border-white/8">
        <button onClick={() => navigate(-1)} className="text-white/40 hover:text-white/70">
          <ChevronLeft size={20} />
        </button>
        <h1 className="text-sm font-semibold">New session</h1>
      </header>

      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-5">
        <div>
          <p className="text-xs text-white/40 mb-2 uppercase tracking-wide">Quick start</p>
          <div className="grid grid-cols-2 gap-2">
            {QUICK.map((q) => (
              <button
                key={q.cmd}
                onClick={() => { setCmd(q.cmd); setName(q.label); }}
                className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border text-left transition-colors ${
                  cmd === q.cmd
                    ? 'border-indigo-500/50 bg-indigo-500/10 text-white'
                    : 'border-white/8 bg-surface-raised text-white/70 hover:border-white/15'
                }`}
              >
                <span>{q.icon}</span>
                <span className="text-xs font-medium">{q.label}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-3">
          {[
            { label: 'Name', value: name, set: setName, placeholder: 'My session', mono: false },
            { label: 'Command', value: cmd, set: setCmd, placeholder: 'claude --dangerously-skip-permissions', mono: true },
            { label: 'Working directory', value: cwd, set: setCwd, placeholder: '~', mono: true },
          ].map(({ label, value, set, placeholder, mono }) => (
            <div key={label}>
              <label className="text-xs text-white/40 block mb-1">{label}</label>
              <input
                value={value}
                onChange={(e) => set(e.target.value)}
                placeholder={placeholder}
                className={`w-full bg-surface-raised border border-white/10 rounded-xl px-3.5 py-2.5 text-sm text-white placeholder:text-white/20 focus:outline-none focus:border-indigo-500/50 ${mono ? 'font-mono' : ''}`}
              />
            </div>
          ))}
        </div>
      </div>

      <div className="p-4 border-t border-white/8 pb-safe">
        <button
          onClick={spawn}
          disabled={!cmd.trim()}
          className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white font-medium py-3 rounded-xl text-sm transition-colors"
        >
          Start session
        </button>
      </div>
    </div>
  );
}
