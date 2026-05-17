import { useEffect } from 'react';
import { getSocket, connectSocket } from '../socket.js';
import { useSessionsStore } from '../store/sessions.js';
import { useMessagesStore } from '../store/messages.js';
import { useHookApprovalStore } from '../store/hookApprovals.js';

export function useSocketEvents() {
  const { setSessions, updateSession, setDaemonOnline } = useSessionsStore();
  const { loadHistory, addChunk, addSnapshot }          = useMessagesStore();

  useEffect(() => {
    const socket = getSocket();

    socket.on('relay:sessions',       ({ sessions }) => setSessions(sessions));
    socket.on('relay:session:update', ({ session })  => updateSession(session));
    socket.on('relay:daemon:status',  ({ daemonId, online }) =>
      setDaemonOnline(daemonId, online));
    socket.on('relay:session:history', ({ sessionId, messages }) =>
      loadHistory(sessionId, messages));
    socket.on('relay:session:chunk',  ({ sessionId, text, rawVt, seq }) =>
      addChunk(sessionId, text, rawVt, seq));
    socket.on('relay:session:snapshot', ({ sessionId, plainText }) =>
      addSnapshot(sessionId, plainText));
    socket.on('relay:hook:approval', ({ approvalId, sessionId, toolName, toolInput }) =>
      useHookApprovalStore.getState().addPending({
        approvalId, sessionId, toolName, toolInput,
      }));

    connectSocket();

    return () => {
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
