import { describe, expect, it } from 'vitest';
import {
  WS_V3_MAGIC as SHARED_MAGIC,
  WS_V3_VERSION as SHARED_VERSION,
  WsV3MessageType,
  WsV3SubscribeFlags,
  decodeWsV3Frame,
} from '@pocket-t/shared';
import {
  WS_V3_MAGIC,
  WS_V3_VERSION,
  MsgType,
  SubscribeFlags,
  encodeFrame,
  decodeFrame,
} from './protocol';

// Drift guard: the web client vendors its own copy of the ws-v3 codec so it
// can build without the shared package's dist. These assertions fail loudly
// if the vendored copy ever drifts from the on-wire contract in
// @pocket-t/shared.
describe('ws-v3 protocol drift guard', () => {
  it('shares the same magic and version as @pocket-t/shared', () => {
    expect(WS_V3_MAGIC).toBe(SHARED_MAGIC);
    expect(WS_V3_VERSION).toBe(SHARED_VERSION);
  });

  it('has the same message-type numbers as @pocket-t/shared', () => {
    expect(MsgType.HELLO).toBe(WsV3MessageType.HELLO);
    expect(MsgType.WELCOME).toBe(WsV3MessageType.WELCOME);
    expect(MsgType.SUBSCRIBE).toBe(WsV3MessageType.SUBSCRIBE);
    expect(MsgType.UNSUBSCRIBE).toBe(WsV3MessageType.UNSUBSCRIBE);
    expect(MsgType.STDOUT).toBe(WsV3MessageType.STDOUT);
    expect(MsgType.SNAPSHOT_VT).toBe(WsV3MessageType.SNAPSHOT_VT);
    expect(MsgType.EVENT).toBe(WsV3MessageType.EVENT);
    expect(MsgType.INPUT_TEXT).toBe(WsV3MessageType.INPUT_TEXT);
    expect(MsgType.INPUT_KEY).toBe(WsV3MessageType.INPUT_KEY);
    expect(MsgType.RESIZE).toBe(WsV3MessageType.RESIZE);
    expect(MsgType.KILL).toBe(WsV3MessageType.KILL);
    expect(MsgType.PING).toBe(WsV3MessageType.PING);
    expect(MsgType.PONG).toBe(WsV3MessageType.PONG);
  });

  it('has the same subscribe-flag bits as @pocket-t/shared', () => {
    expect(SubscribeFlags.Stdout).toBe(WsV3SubscribeFlags.Stdout);
    expect(SubscribeFlags.Snapshots).toBe(WsV3SubscribeFlags.Snapshots);
    expect(SubscribeFlags.Events).toBe(WsV3SubscribeFlags.Events);
  });

  it('encodes a frame the shared decoder can read', () => {
    const payload = new TextEncoder().encode('hello world');
    const bytes = encodeFrame({ type: MsgType.INPUT_TEXT, sessionId: 'abc', payload });
    const decoded = decodeWsV3Frame(bytes);
    expect(decoded).not.toBeNull();
    expect(decoded?.type).toBe(WsV3MessageType.INPUT_TEXT);
    expect(decoded?.sessionId).toBe('abc');
    expect(new TextDecoder().decode(decoded?.payload)).toBe('hello world');
  });
});

describe('ws-v3 codec round-trip', () => {
  it('round-trips through its own encode/decode', () => {
    const payload = new TextEncoder().encode('{"kind":"bubble"}');
    const bytes = encodeFrame({ type: MsgType.EVENT, sessionId: 's-1', payload });
    const frame = decodeFrame(bytes);
    expect(frame?.type).toBe(MsgType.EVENT);
    expect(frame?.sessionId).toBe('s-1');
    expect(new TextDecoder().decode(frame?.payload)).toBe('{"kind":"bubble"}');
  });

  it('rejects a truncated frame', () => {
    expect(decodeFrame(new Uint8Array(4))).toBeNull();
  });
});
