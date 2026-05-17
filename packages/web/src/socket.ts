import { io, type Socket } from 'socket.io-client';
import type { RelayToClientEvents, ClientEmitEvents } from '@pocket-t/shared';

type ClientSocket = Socket<RelayToClientEvents, ClientEmitEvents>;

let _socket: ClientSocket | null = null;

// A-001/A-002: auth comes from the httpOnly `pocket-t_sess` cookie sent on
// the handshake (withCredentials). No JWT is ever exposed to JS / stored
// in localStorage — the relay validates the cookie against web_sessions.
export function getSocket(): ClientSocket {
  if (_socket) return _socket;
  // Connect to the /client namespace (relay handles /client + /daemon only).
  _socket = io('/client', {
    path:              '/socket.io',
    withCredentials:   true,
    transports:        ['websocket'],
    autoConnect:       false,
    reconnectionDelayMax: 10_000,
  }) as unknown as ClientSocket;
  return _socket;
}

export function connectSocket()    { getSocket().connect(); }
export function disconnectSocket() { _socket?.disconnect(); _socket = null; }
