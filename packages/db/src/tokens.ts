import { createHash, randomBytes } from 'node:crypto';
import type { CollectorKind } from '@undercut/core';

/**
 * Device tokens are 256-bit random secrets, so a single SHA-256 is the right hash: there is
 * nothing to brute-force, and lookups stay an indexed equality match. (Slow hashes like bcrypt
 * exist for low-entropy human passwords.)
 */
export function generateToken(kind: CollectorKind): { token: string; hash: string; hint: string } {
  const token = `uc_${kind}_${randomBytes(32).toString('base64url')}`;
  return { token, hash: hashToken(token), hint: token.slice(-4) };
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}
