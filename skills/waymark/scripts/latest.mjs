#!/usr/bin/env node
// Waymark · refreshes ~/.waymark/.latest.json with the version main publishes (docs/adr/0066). Started detached by the session hook when the cache is older than six hours.
import { fetchLatest, keepLatest } from './lib/latest.mjs';
keepLatest(await fetchLatest());
