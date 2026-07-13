/**
 * Browser-safe ws-v3 codec.
 *
 * This is a faithful ADAPTATION of packages/shared/src/ws-v3.ts — same
 * magic ("PT" = 0x5450), same version (3), same type numbers, same
 * subscribe/resize payload layouts. It is NOT a fork of the protocol:
 * every byte on the wire is identical to what the daemon encodes/decodes
 * in server.ts. We vendor it here (rather than importing @pocket-t/shared
 * at runtime) purely so the web-client builds standalone without needing
 * the shared package's dist/ to exist first. If the wire ever changes,
 * shared/src/ws-v3.ts is the source of truth and this file must follow.
 *
 * ws-v3.ts uses no Node APIs (only DataView / TextEncoder / TextDecoder),
 * so the encode/decode logic below is copied verbatim in behaviour.
 */

export const WS_V3_MAGIC = 0x5450; // "PT"
export const WS_V3_VERSION = 3;

export enum MsgType {
  HELLO = 1,
  WELCOME = 2,
  SUBSCRIBE = 10,
  UNSUBSCRIBE = 11,
  STDOUT = 20,
  SNAPSHOT_VT = 21,
  EVENT = 22,
  ERROR = 23,
  INPUT_TEXT = 30,
  INPUT_KEY = 31,
  RESIZE = 32,
  KILL = 33,
  RESET_SIZE = 34,
  PING = 40,
  PONG = 41,
}

export enum SubscribeFlags {
  Stdout = 1 << 0,
  Snapshots = 1 << 1,
  Events = 1 << 2,
}

export interface DecodedFrame {
  type: MsgType;
  sessionId: string;
  payload: Uint8Array;
}

const te = new TextEncoder();
const td = new TextDecoder();

export function encodeFrame(params: {
  type: MsgType;
  sessionId?: string;
  payload?: Uint8Array;
}): Uint8Array {
  const sessionId = params.sessionId ?? '';
  const sidBytes = te.encode(sessionId);
  const payload = params.payload ?? new Uint8Array();

  const headerLen = 2 + 1 + 1 + 4 + sidBytes.length + 4;
  const out = new Uint8Array(headerLen + payload.length);
  const view = new DataView(out.buffer);

  let o = 0;
  view.setUint16(o, WS_V3_MAGIC, true);
  o += 2;
  view.setUint8(o, WS_V3_VERSION);
  o += 1;
  view.setUint8(o, params.type);
  o += 1;
  view.setUint32(o, sidBytes.length, true);
  o += 4;
  out.set(sidBytes, o);
  o += sidBytes.length;
  view.setUint32(o, payload.length, true);
  o += 4;
  out.set(payload, o);
  return out;
}

export function decodeFrame(data: Uint8Array): DecodedFrame | null {
  if (data.byteLength < 12) return null;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let o = 0;

  if (view.getUint16(o, true) !== WS_V3_MAGIC) return null;
  o += 2;
  if (view.getUint8(o) !== WS_V3_VERSION) return null;
  o += 1;
  const type = view.getUint8(o) as MsgType;
  o += 1;
  const sidLen = view.getUint32(o, true);
  o += 4;
  if (o + sidLen > data.byteLength) return null;
  const sessionId = td.decode(data.subarray(o, o + sidLen));
  o += sidLen;
  const payloadLen = view.getUint32(o, true);
  o += 4;
  if (o + payloadLen > data.byteLength) return null;
  const payload = data.subarray(o, o + payloadLen);
  return { type, sessionId, payload };
}

export function encodeSubscribePayload(params: {
  flags: number;
  snapshotMinIntervalMs?: number;
  snapshotMaxIntervalMs?: number;
}): Uint8Array {
  const out = new Uint8Array(12);
  const view = new DataView(out.buffer);
  view.setUint32(0, params.flags >>> 0, true);
  view.setUint32(4, (params.snapshotMinIntervalMs ?? 0) >>> 0, true);
  view.setUint32(8, (params.snapshotMaxIntervalMs ?? 0) >>> 0, true);
  return out;
}

export function encodeResizePayload(cols: number, rows: number): Uint8Array {
  const out = new Uint8Array(8);
  const view = new DataView(out.buffer);
  view.setUint32(0, cols >>> 0, true);
  view.setUint32(4, rows >>> 0, true);
  return out;
}

/** HELLO payload = [protocolVersion=1, ...tokenUtf8]. Matches the daemon's
 *  relay-auth gate in server.ts (handleIncomingFrame HELLO branch), which
 *  reads payload[0] as version and payload[1..] as the bearer token. */
export function encodeHelloPayload(token: string): Uint8Array {
  const tokenBytes = te.encode(token);
  const out = new Uint8Array(1 + tokenBytes.length);
  out[0] = 1;
  out.set(tokenBytes, 1);
  return out;
}

export const decodeText = (u: Uint8Array): string => td.decode(u);
export const encodeText = (s: string): Uint8Array => te.encode(s);
