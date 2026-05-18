import { io, type Socket } from 'socket.io-client';
import type { RelayToClientEvents, ClientEmitEvents } from '@pocket-t/shared';

type ClientSocket = Socket<RelayToClientEvents, ClientEmitEvents>;

let _socket: ClientSocket | null = null;

// A-001/A-002: auth comes from the httpOnly `pocket-t_sess` cookie sent on
// the handshake (withCredentials). No JWT is ever exposed to JS / stored
// in localStorage — the relay validates the cookie against web_sessions.
//
// Hosting topology: in dev the Vite proxy forwards same-origin
// /socket.io → relay. In a static (Vercel) prod deploy there is no proxy,
// and Vercel cannot reliably proxy the WebSocket upgrade, so the realtime
// socket must connect to the relay's origin directly. Set VITE_RELAY_URL
// (e.g. https://relay.pocket-t.ai) at build time; leave it unset for the
// same-origin dev/reverse-proxy setup. The relay's CORS allows it.
const RELAY_BASE = (import.meta.env.VITE_RELAY_URL as string | undefined) ?? '';

export function getSocket(): ClientSocket {
  if (_socket) return _socket;
  // Connect to the /client namespace (relay handles /client + /daemon only).
  _socket = io(`${RELAY_BASE}/client`, {
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
