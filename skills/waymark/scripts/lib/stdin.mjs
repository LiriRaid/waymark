// A hook's input: what the agent writes to its stdin. A fixed one-second fallback fired before the input had been read on a machine so busy that the
// process was not scheduled for a second, and the hook judged an empty call (no record, no gate: it failed open). So the input is read until it is
// complete: a JSON object that parses is the whole call (an agent that leaves stdin open is not waited for), else the stream's end, else `max`
// (WAYMARK_STDIN_MS sets it for the tests). Only a terminal (a hook run by hand) gives up early.
export function readStdin(done, { idle = 1000, max = Number(process.env.WAYMARK_STDIN_MS) || 8000 } = {}) {
  let input = '', over = false;
  const finish = () => { if (over) return; over = true; done(input); try { process.stdin.destroy(); } catch {} };
  process.stdin.on('data', (d) => {
    input += d;
    if (/^\s*[{[]/.test(input)) { try { JSON.parse(input); finish(); } catch { /* a part of the object: the next chunk or the end */ } }
  });
  process.stdin.on('end', finish);
  process.stdin.resume();
  // a Kiro IDE hook carries no JSON (its prompt is in USER_PROMPT) and may leave stdin open: it is not waited for the full `max` (docs/adr/0063)
  if (process.stdin.isTTY || /(?:^|\s)--agent\s+kiro(?:\s|$)/.test(process.argv.join(' '))) setTimeout(() => { if (!input.trim()) finish(); }, process.stdin.isTTY ? idle : 600).unref();
  setTimeout(finish, max).unref();
}
