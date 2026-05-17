import {
  randomBytes,
  createCipheriv,
  createDecipheriv,
} from 'node:crypto';

const ALGO      = 'aes-128-gcm';
const KEY_BYTES = 16;   // 128 bits
const IV_BYTES  = 12;   // 96 bits (GCM standard)
const AUTH_TAG  = 16;   // 128 bits

export interface EncryptedPayload {
  iv:      string;   // hex
  data:    string;   // hex
  tag:     string;   // hex (GCM auth tag)
}

export class KeyManager {
  private outputKey: Buffer;  // daemon → relay → browser
  private inputKey:  Buffer;  // browser → relay → daemon
  private msgCount   = 0;
  private readonly ROTATE_AT = 1_048_576;  // 2^20 messages

  constructor() {
    this.outputKey = randomBytes(KEY_BYTES);
    this.inputKey  = randomBytes(KEY_BYTES);
  }

  // Returns both keys as base64 — only sent to browser via secure out-of-band channel
  exportKeys(): { outputKey: string; inputKey: string } {
    return {
      outputKey: this.outputKey.toString('base64'),
      inputKey:  this.inputKey.toString('base64'),
    };
  }

  // Encrypt a PTY output chunk before sending to relay
  encrypt(plaintext: string): EncryptedPayload {
    this.maybeRotate();
    const iv     = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGO, this.outputKey, iv);
    const data   = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();
    return {
      iv:   iv.toString('hex'),
      data: data.toString('hex'),
      tag:  tag.toString('hex'),
    };
  }

  // Decrypt input received from browser via relay
  decrypt(payload: EncryptedPayload): string {
    const decipher = createDecipheriv(
      ALGO,
      this.inputKey,
      Buffer.from(payload.iv, 'hex'),
    );
    decipher.setAuthTag(Buffer.from(payload.tag, 'hex'));
    return Buffer.concat([
      decipher.update(Buffer.from(payload.data, 'hex')),
      decipher.final(),
    ]).toString('utf8');
  }

  private maybeRotate() {
    this.msgCount++;
    if (this.msgCount >= this.ROTATE_AT) {
      this.outputKey = randomBytes(KEY_BYTES);
      this.inputKey  = randomBytes(KEY_BYTES);
      this.msgCount  = 0;
      console.log('[crypto] Keys rotated after 2^20 messages');
    }
  }
}
