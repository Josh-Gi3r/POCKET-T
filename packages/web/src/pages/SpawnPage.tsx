import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';
import { getSocket } from '../socket.js';
import { BottomNav } from '../components/BottomNav.js';
import { ConnectionBar } from '../components/ConnectionBar.js';

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
    <div className="app-shell flex flex-col app-h">
      <header className="glass-panel mx-3 mt-3 flex items-center gap-3 px-4 pt-safe pb-3 pt-3 rounded-[28px]">
        <button onClick={() => navigate(-1)} className="text-slate-500 hover:text-violet-600">
          <ChevronLeft size={20} />
        </button>
        <h1 className="text-sm font-semibold text-slate-900">New session</h1>
      </header>

      <ConnectionBar />

      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-5">
        <div>
          <p className="text-xs text-slate-500 mb-2 uppercase tracking-wide font-semibold">Quick start</p>
          <div className="grid grid-cols-2 gap-2">
            {QUICK.map((q) => (
              <button
                key={q.cmd}
                onClick={() => { setCmd(q.cmd); setName(q.label); }}
                className={`flex items-center gap-2 px-3 py-2.5 rounded-[22px] text-left transition ${
                  cmd === q.cmd
                    ? 'lavender-button'
                    : 'glass-card text-slate-600 hover:bg-white/65'
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
              <label className="text-xs text-slate-500 block mb-1 font-medium">{label}</label>
              <input
                value={value}
                onChange={(e) => set(e.target.value)}
                placeholder={placeholder}
                className={`soft-input w-full rounded-[22px] px-3.5 py-2.5 text-base focus:outline-none focus:ring-2 focus:ring-violet-300/50 ${mono ? 'font-mono' : ''}`}
              />
            </div>
          ))}
        </div>
      </div>

      <div className="p-4 pb-safe">
        <button
          onClick={spawn}
          disabled={!cmd.trim()}
          className="lavender-button w-full disabled:opacity-40 font-semibold py-3 rounded-[24px] text-sm transition active:scale-[0.99]"
        >
          Start session
        </button>
      </div>

      <BottomNav />
    </div>
  );
}
