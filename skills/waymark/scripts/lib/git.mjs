// git in a folder; the caller picks encoding and timeout when the default does not fit.
import { spawnSync } from 'node:child_process';

export const git = (cwd, args, opts = {}) => spawnSync('git', args, { cwd, timeout: 3000, maxBuffer: 32 * 1024 * 1024, ...opts });
