import { useEffect } from 'react';
import { getSocket, connectSocket } from '../socket.js';
import { useSessionsStore } from '../store/sessions.js';
import { useMessagesStore } from '../store/messages.js';
import { useHookApprovalStore } from '../store/hookApprovals.js';
import { useUiStore } from '../store/ui.js';

export function useSocketEvents() {
  const { setSessions, updateSession, setDaemonOnline } = useSessionsStore();
  const { loadHistory, addChunk, addRawVt, addTurn, addSnapshot }  = useMessagesStore();

  useEffect(() => {
    const socket = getSocket();

    // Connection state → visible banner (no more silently-frozen screen).
    socket.on('connect',    () => useUiStore.getState().setConn('connected'));
    socket.on('disconnect', () => useUiStore.getState().setConn('disconnected'));
    socket.on('connect_error', () =>
      useUiStore.getState().setConn('connecting'));
    socket.io.on('reconnect_attempt', () =>
      useUiStore.getState().setConn('connecting'));

    // Surface relay errors (RATE_LIMITED / BAD_INPUT / NOT_FOUND / NO_DAEMON)
    // instead of dropping input with zero feedback.
    socket.on('relay:error', ({ message }) =>
      useUiStore.getState().pushToast(message || 'Something went wrong', 'error'));

    socket.on('relay:sessions',       ({ sessions }) => setSessions(sessions));
    socket.on('relay:session:update', ({ session })  => updateSession(session));
    socket.on('relay:daemon:status',  ({ daemonId, online }) =>
      setDaemonOnline(daemonId, online));
    socket.on('relay:session:history', ({ sessionId, messages }) =>
      loadHistory(sessionId, messages));
    socket.on('relay:session:chunk',  ({ sessionId, text, rawVt, seq, kind, role }) => {
      // A kind-tagged chunk is a complete structured agent turn → its own
      // typed bubble. Untagged = raw terminal stream → existing streaming.
      if (kind) {
        addTurn(sessionId, role ?? 'cli', kind, text, seq);
        return;
      }

      const session = useSessionsStore.getState()
        .sessions.find((s) => s.id === sessionId);
      if (session?.cmd.split(/\s+/)[0]?.split('/').pop() === 'claude') {
        addRawVt(sessionId, rawVt);
        return;
      }

      addChunk(sessionId, text, rawVt, seq);
    });
    socket.on('relay:session:snapshot', ({ sessionId, plainText, rawVt }) =>
      addSnapshot(sessionId, plainText, rawVt));
    socket.on('relay:hook:approval', ({ approvalId, sessionId, toolName, toolInput }) =>
      useHookApprovalStore.getState().addPending({
        approvalId, sessionId, toolName, toolInput,
      }));

    connectSocket();

    return () => {
      socket.off('connect');
      socket.off('disconnect');
      socket.off('connect_error');
      socket.io.off('reconnect_attempt');
      socket.off('relay:error');
      socket.off('relay:sessions');
      socket.off('relay:session:update');
      socket.off('relay:daemon:status');
      socket.off('relay:session:history');
      socket.off('relay:session:chunk');
      socket.off('relay:session:snapshot');
      socket.off('relay:hook:approval');
    };
  }, []);
}
