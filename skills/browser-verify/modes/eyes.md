# browser-verify · mode: eyes

Loaded on demand from `../SKILL.md` → *Modes*. The end-of-turn hook asks for it (testigo "Ojos", ADR 0047) after a seen change; it is not offered, it is done.

- **When:** an L2/L3 task that created or changed something seen, or an L1 change of CSS/HTML only with no spec (a spec cannot see layout). With no browser on the machine the hook says so and asks nothing.
- **Source of truth:** the screenshots the user sent or the design link they wrote. Before building, list each element asked or visible in them (text, state, width, viewport). Without a reference, the task's own criteria are the list.
- **Steps:**
  1. Dev server: the `eyes` row of the project's `memory.md` (command, port, local URL; never credentials). With none, confirm it once in the choice window and save it there. Start it, use it, stop it.
  2. With ego: read `ego-browser skill`, one task space, the viewport the task claims (`Emulation.setDeviceMetricsOverride`, 390 for mobile), then per element a measurement (`getBoundingClientRect`, `getComputedStyle`) or a real click with the state after it. A `goto` and a snapshot alone measure nothing.
  3. Capture each state to `~/.waymark/eyes/<project>/<task>/<element>-<width>.png` (never in the repo; `check` lists them; deleted after 7 days). Compare the capture with the reference point by point; the model compares, with the measurement beside it.
  4. Close the task space (`finish({ keep: [] })`) and stop the server.
- **Output:** in the Cierre, one line per listed element: `<element>: igual | parecido | falta — <measurement>`. A measurement older than the last change does not count: after any later edit, measure again.
- **Never:** a build or a spec as the look of the screen; credentials; a host other than the local one and the design link; a command that clears the browser profile.
- **No way to look** (no dev server possible, the screen needs a login the user has not made): `Ojos: no (<why>)` after the block, and the Cierre says "inferida" with the check for the user.
