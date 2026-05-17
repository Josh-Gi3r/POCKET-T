import { io, type Socket } from 'socket.io-client';
import type { RelayToClientEvents, ClientEmitEvents } from '@pocket-t/shared';

type ClientSocket = Socket<RelayToClientEvents, ClientEmitEvents>;

let _socket: ClientSocket | null = null;

export function getSocket(): ClientSocket {
  if (_socket) return _socket;
  _socket = io('', {
    path:              '/socket.io',
    auth:              { token: getStoredToken(), scope: 'client' },
    transports:        ['websocket'],
    autoConnect:       false,
    reconnectionDelayMax: 10_000,
  }) as unknown as ClientSocket;
  return _socket;
}

export function connectSocket()    { getSocket().connect(); }
export function disconnectSocket() { _socket?.disconnect(); _socket = null; }

const TOKEN_KEY = 'pocket-t_token';
export function getStoredToken()              { return localStorage.getItem(TOKEN_KEY); }
export function storeToken(t: string)         { localStorage.setItem(TOKEN_KEY, t); }
export function clearToken()                  { localStorage.removeItem(TOKEN_KEY); }
