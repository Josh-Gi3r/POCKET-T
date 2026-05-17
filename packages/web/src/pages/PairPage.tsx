import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Shield } from 'lucide-react';

export function PairPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate      = useNavigate();
  const [status, setStatus] = useState<'loading' | 'ok' | 'error'>('loading');

  useEffect(() => {
    const hash = window.location.hash.slice(1);
    if (!hash) { setStatus('error'); return; }

    const params = new URLSearchParams(hash);
    const ok = params.has('outputKey') && params.has('inputKey');

    if (ok) {
      // Keys are already in the fragment — the useCrypto hook will pick them up
      // when we navigate to the chat page.
      setStatus('ok');
      setTimeout(() => {
        navigate(`/chat/${sessionId}${window.location.hash}`);
      }, 1000);
    } else {
      setStatus('error');
    }
  }, [sessionId]);

  return (
    <div className="flex flex-col items-center justify-center h-screen bg-surface gap-5 p-8">
      <div className="w-14 h-14 rounded-2xl bg-violet-500/10 flex items-center justify-center">
        <Shield size={28} className="text-violet-400" />
      </div>
      {status === 'loading' && (
        <p className="text-sm text-white/50">Setting up encryption…</p>
      )}
      {status === 'ok' && (
        <>
          <p className="text-base font-medium text-white">E2E Encryption active</p>
          <p className="text-sm text-white/40 text-center">
            Your session is end-to-end encrypted.
            The relay cannot read your terminal output.
          </p>
        </>
      )}
      {status === 'error' && (
        <p className="text-sm text-red-400">
          Invalid pairing link. Generate a new one from the Dashboard.
        </p>
      )}
    </div>
  );
}
