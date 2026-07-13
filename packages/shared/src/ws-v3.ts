/**
 * ws-v3 — pocket-t's binary frame protocol over WebSocket.
 *
 * Lifted in shape from VibeTunnel (web/src/shared/ws-v3.ts, MIT). Same
 * type numbers and same subscribe-with-flags semantics. We use the magic
 * "PT" instead of VibeTunnel's "VT" so the wire is clearly ours.
 *
 * Frame layout (all little-endian):
 *
 *   u16 magic       = 0x5450 ("PT")
 *   u8  version     = 3
 *   u8  type
 *   u32 sessionIdLen
 *   u8[] sessionId  (UTF-8)
 *   u32 payloadLen
 *   u8[] payload
 *
 * Subscribe semantics: a client SUBSCRIBE-s to a session with a bitmask
 * choosing which substreams it wants:
 *   Stdout    — raw PTY output bytes
 *   Snapshots — periodic VT screen snapshots (configurable interval)
 *   Events    — lifecycle / adapter / cost events
 *
 * The reconnection-owns-resubscribe rule (ports VibeTunnel's iOS
 * ReconnectionManager pattern): a fresh connection sends HELLO, then
 * (re-)SUBSCRIBE for every session the client is currently watching.
 * The bug class "I reconnected but the UI doesn't update" becomes
 * impossible by design — re-subscribe IS the reconnect.
 */

export const WS_V3_MAGIC = 0x5450;
export const WS_V3_VERSION = 3;

export enum WsV3MessageType {
  HELLO   = 1,
  WELCOME = 2,

  SUBSCRIBE   = 10,
  UNSUBSCRIBE = 11,

  STDOUT       = 20,
  SNAPSHOT_VT  = 21,
  EVENT        = 22,
  ERROR        = 23,

  INPUT_TEXT  = 30,
  INPUT_KEY   = 31,
  RESIZE      = 32,
  KILL        = 33,
  RESET_SIZE  = 34,

  PING = 40,
  PONG = 41,
}

export enum WsV3SubscribeFlags {
  Stdout    = 1 << 0,
  Snapshots = 1 << 1,
  Events    = 1 << 2,
}

export interface WsV3DecodedFrame {
  type:      WsV3MessageType;
  sessionId: string;
  payload:   Uint8Array;
}

export function encodeWsV3Frame(params: {
  type:       WsV3MessageType;
  sessionId?: string;
  payload?:   Uint8Array;
}): Uint8Array {
  const sessionId      = params.sessionId ?? '';
  const sessionIdBytes = new TextEncoder().encode(sessionId);
  const payload        = params.payload ?? new Uint8Array();

  const headerLen = 2 + 1 + 1 + 4 + sessionIdBytes.length + 4;
  const out       = new Uint8Array(headerLen + payload.length);
  const view      = new DataView(out.buffer, out.byteOffset, out.byteLength);

  let offset = 0;
  view.setUint16(offset, WS_V3_MAGIC, true);
  offset += 2;
  view.setUint8(offset, WS_V3_VERSION);
  offset += 1;
  view.setUint8(offset, params.type);
  offset += 1;

  view.setUint32(offset, sessionIdBytes.length, true);
  offset += 4;
  out.set(sessionIdBytes, offset);
  offset += sessionIdBytes.length;

  view.setUint32(offset, payload.length, true);
  offset += 4;
  out.set(payload, offset);

  return out;
}

export function decodeWsV3Frame(data: Uint8Array): WsV3DecodedFrame | null {
  // Minimum frame is 12 bytes (header) with empty sessionId and empty payload.
  if (data.byteLength < 12) return null;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let offset = 0;

  const magic = view.getUint16(offset, true);
  offset += 2;
  if (magic !== WS_V3_MAGIC) return null;

  const version = view.getUint8(offset);
  offset += 1;
  if (version !== WS_V3_VERSION) return null;

  const type = view.getUint8(offset) as WsV3MessageType;
  offset += 1;

  const sessionIdLen = view.getUint32(offset, true);
  offset += 4;
  if (offset + sessionIdLen > data.byteLength) return null;
  const sessionId = new TextDecoder().decode(data.subarray(offset, offset + sessionIdLen));
  offset += sessionIdLen;

  const payloadLen = view.getUint32(offset, true);
  offset += 4;
  if (offset + payloadLen > data.byteLength) return null;

  const payload = data.subarray(offset, offset + payloadLen);
  return { type, sessionId, payload };
}

export function encodeSubscribePayload(params: {
  flags:                  number;
  snapshotMinIntervalMs?: number;
  snapshotMaxIntervalMs?: number;
}): Uint8Array {
  const out  = new Uint8Array(12);
  const view = new DataView(out.buffer);
  view.setUint32(0, params.flags >>> 0, true);
  view.setUint32(4, (params.snapshotMinIntervalMs ?? 0) >>> 0, true);
  view.setUint32(8, (params.snapshotMaxIntervalMs ?? 0) >>> 0, true);
  return out;
}

export function decodeSubscribePayload(payload: Uint8Array): {
  flags:                 number;
  snapshotMinIntervalMs: number;
  snapshotMaxIntervalMs: number;
} | null {
  if (payload.byteLength < 12) return null;
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  return {
    flags:                 view.getUint32(0, true),
    snapshotMinIntervalMs: view.getUint32(4, true),
    snapshotMaxIntervalMs: view.getUint32(8, true),
  };
}

export function encodeResizePayload(cols: number, rows: number): Uint8Array {
  const out  = new Uint8Array(8);
  const view = new DataView(out.buffer);
  view.setUint32(0, cols >>> 0, true);
  view.setUint32(4, rows >>> 0, true);
  return out;
}

export function decodeResizePayload(payload: Uint8Array): { cols: number; rows: number } | null {
  if (payload.byteLength < 8) return null;
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  return { cols: view.getUint32(0, true), rows: view.getUint32(4, true) };
}
