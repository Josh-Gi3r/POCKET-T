import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import {
  BrowserRouter, Routes, Route, Navigate,
} from 'react-router-dom';
import './styles/global.css';
import { useAuthStore } from './store/auth.js';
import { useSocketEvents } from './hooks/useSocket.js';
import { LoginPage }     from './pages/LoginPage.js';
import { InboxPage }     from './pages/InboxPage.js';
import { ChatPage }      from './pages/ChatPage.js';
import { SpawnPage }     from './pages/SpawnPage.js';
import { DashboardPage } from './pages/DashboardPage.js';
import { PairPage }      from './pages/PairPage.js';
import { TeamPage }      from './pages/TeamPage.js';

// Phase 2: paid hosting + E2E pairing UI. Off until the team/billing auth
// model and the encrypted transport path are complete (audit A-009/A-010).
const PHASE_2 = false;

// Register service worker
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(console.error);
  });
}

function AuthedApp() {
  const { accountId, isLoading } = useAuthStore();
  useSocketEvents();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen bg-surface">
        <div className="text-white/20 text-sm font-mono">loading…</div>
      </div>
    );
  }

  if (!accountId) return <Navigate to="/login" replace />;

  return (
    <Routes>
      <Route path="/"                  element={<InboxPage />} />
      <Route path="/chat/:sessionId"   element={<ChatPage />} />
      <Route path="/spawn"             element={<SpawnPage />} />
      <Route path="/dashboard"         element={<DashboardPage />} />
      {PHASE_2 && <Route path="/team"  element={<TeamPage />} />}
      <Route path="*"                  element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function App() {
  const { setAuth, setLoading } = useAuthStore();

  useEffect(() => {
    fetch('/api/auth/me', { credentials: 'include' })
      .then((r) => r.ok ? r.json() : null)
      .then((me: any) => {
        if (me?.accountId) setAuth({
          accountId: me.accountId,
          email:     me.email,
          plan:      me.plan,
        });
        else setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        {PHASE_2 && <Route path="/pair/:sessionId" element={<PairPage />} />}
        <Route path="/*"     element={<AuthedApp />} />
      </Routes>
    </BrowserRouter>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
