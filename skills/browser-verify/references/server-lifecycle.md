# browser-verify · Server lifecycle

Loaded on demand when the app must be started or stopped.

1. **Already running?** `node scripts/wait-for-port.mjs <url> --timeout 3`. Exit 0 → reuse it and do not stop it at the end (it is not yours).
2. **Find the command.** Project memory → the `eyes` row of Quality gates (or the older `dev server` row); else the stack default below; else the `dev`/`start` script in the manifest. Never invent one.
3. **Start it in the background.** Built-in pane: `preview_start` with a `.claude/launch.json` entry (tell the user before adding that file to the repository). Otherwise run the command with the shell tool in background mode.
4. **Wait for readiness.** `node scripts/wait-for-port.mjs <url> --timeout 120` (exit 0 ready, 1 timeout, 2 bad arguments or non-local host). On timeout read the server output, report the first error and stop; do not test a half-started app.
5. **Backend needed too?** Start it first, wait for its port, then the frontend.
6. **Stop what you started** when done: `preview_stop`, or stop the background task / process. Leave servers the user started running.
7. First successful start in a project → record the dev command, URL and port in project memory (*Quality gates*, row `eyes`: command · local URL; never credentials).

| Stack | Default dev command | Default URL |
|---|---|---|
| Angular | `pnpm start` (or `pnpm exec ng serve`) | `http://localhost:4200` |
| React + Vite | `<pm> run dev` | `http://localhost:5173` |
| Next.js | `<pm> run dev` | `http://localhost:3000` |
| Rails | `bin/dev` if present, else `bundle exec rails s` | `http://localhost:3000` |
| NestJS (API behind a UI) | `pnpm run start:dev` | `http://localhost:3000` |
