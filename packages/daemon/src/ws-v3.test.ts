import { describe, it, expect } from 'vitest';
import {
  WS_V3_MAGIC,
  WS_V3_VERSION,
  WsV3MessageType,
  WsV3SubscribeFlags,
  encodeWsV3Frame,
  decodeWsV3Frame,
  encodeSubscribePayload,
  decodeSubscribePayload,
  encodeResizePayload,
  decodeResizePayload,
} from '@pocket-t/shared';

describe('ws-v3 frame protocol', () => {
  it('encode then decode is the identity (with sessionId + payload)', () => {
    const payload = new TextEncoder().encode('hello, terminal');
    const frame = encodeWsV3Frame({
      type:      WsV3MessageType.STDOUT,
      sessionId: 'pt-12345',
      payload,
    });
    const decoded = decodeWsV3Frame(frame);
    expect(decoded).not.toBeNull();
    expect(decoded!.type).toBe(WsV3MessageType.STDOUT);
    expect(decoded!.sessionId).toBe('pt-12345');
    expect(new TextDecoder().decode(decoded!.payload)).toBe('hello, terminal');
  });

  it('encodes the correct magic bytes ("PT") and version', () => {
    const frame = encodeWsV3Frame({ type: WsV3MessageType.HELLO });
    const view  = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
    expect(view.getUint16(0, true)).toBe(WS_V3_MAGIC);   // 0x5450 = 'P''T'
    expect(view.getUint8(2)).toBe(WS_V3_VERSION);
    expect(view.getUint8(3)).toBe(WsV3MessageType.HELLO);
  });

  it('rejects a frame with the wrong magic', () => {
    const frame = encodeWsV3Frame({ type: WsV3MessageType.PING });
    frame[0] = 0xff;
    expect(decodeWsV3Frame(frame)).toBeNull();
  });

  it('rejects a frame shorter than the header', () => {
    expect(decodeWsV3Frame(new Uint8Array(5))).toBeNull();
    expect(decodeWsV3Frame(new Uint8Array(0))).toBeNull();
  });

  it('rejects a frame with the wrong version', () => {
    const frame = encodeWsV3Frame({ type: WsV3MessageType.PING });
    frame[2] = 9;
    expect(decodeWsV3Frame(frame)).toBeNull();
  });

  it('handles an empty payload + empty sessionId cleanly', () => {
    const frame = encodeWsV3Frame({ type: WsV3MessageType.WELCOME });
    expect(frame.byteLength).toBe(12);  // 2 magic + 1 ver + 1 type + 4 sidLen + 4 plLen
    const decoded = decodeWsV3Frame(frame);
    expect(decoded!.type).toBe(WsV3MessageType.WELCOME);
    expect(decoded!.sessionId).toBe('');
    expect(decoded!.payload.byteLength).toBe(0);
  });

  it('subscribe payload: encode/decode flags + intervals', () => {
    const enc = encodeSubscribePayload({
      flags: WsV3SubscribeFlags.Stdout | WsV3SubscribeFlags.Snapshots | WsV3SubscribeFlags.Events,
      snapshotMinIntervalMs: 250,
      snapshotMaxIntervalMs: 2_000,
    });
    const dec = decodeSubscribePayload(enc);
    expect(dec).not.toBeNull();
    expect(dec!.flags).toBe(0b111);
    expect(dec!.snapshotMinIntervalMs).toBe(250);
    expect(dec!.snapshotMaxIntervalMs).toBe(2_000);
  });

  it('resize payload: encode/decode roundtrip', () => {
    const enc = encodeResizePayload(120, 30);
    const dec = decodeResizePayload(enc);
    expect(dec).toEqual({ cols: 120, rows: 30 });
  });

  it('utf-8 multibyte sessionId roundtrips', () => {
    const frame = encodeWsV3Frame({
      type:      WsV3MessageType.SUBSCRIBE,
      sessionId: '会话-🚀-42',
    });
    const dec = decodeWsV3Frame(frame);
    expect(dec!.sessionId).toBe('会话-🚀-42');
  });
});
