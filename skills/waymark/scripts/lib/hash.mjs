// sha256 of a string, hex.
import crypto from 'node:crypto';

export const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
