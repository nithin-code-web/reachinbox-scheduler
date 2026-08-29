import crypto from 'node:crypto';
import { env } from '../config/env.js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const TOKEN_FORMAT = 'v1';

function encryptionKey(): Buffer {
  if (!env.SLACK_TOKEN_ENCRYPTION_KEY) {
    throw new Error('Slack token encryption is not configured');
  }

  return Buffer.from(env.SLACK_TOKEN_ENCRYPTION_KEY, 'hex');
}

export function encryptSlackToken(token: string): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [
    TOKEN_FORMAT,
    iv.toString('hex'),
    authTag.toString('hex'),
    ciphertext.toString('hex'),
  ].join(':');
}

export function decryptSlackToken(value: string): string {
  const [version, ivHex, authTagHex, ciphertextHex] = value.split(':');
  if (
    version !== TOKEN_FORMAT ||
    !ivHex ||
    !authTagHex ||
    !ciphertextHex ||
    ivHex.length !== IV_LENGTH * 2
  ) {
    throw new Error('Invalid Slack token ciphertext');
  }

  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    encryptionKey(),
    Buffer.from(ivHex, 'hex'),
  );
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));

  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextHex, 'hex')),
    decipher.final(),
  ]).toString('utf8');
}
