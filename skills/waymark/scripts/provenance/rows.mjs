// Waymark · the rows tasks.md prints from records that are not a closed task's own line (docs/adr/0012).

// The user's own steps of a task the hook closed as hecho: their manual test is "pendiente tuyo", a step (deploy, PR) is "tuyo".
export const ownedCell = (owned) => {
  const steps = owned.filter((s) => s !== 'manual');
  return `hecho (${[...(owned.includes('manual') ? ['pendiente tuyo: prueba manual'] : []), ...(steps.length ? [`${steps.join(', ')}: tuyo`] : [])].join('; ')})`;
};

// A turn the hook deferred (a review or an agent still running in the background) or could not judge (kind "unevaluated") that no later close of its session covers:
// it is listed, the newest `limit`, so it is not left blank when its evaluation never comes.
export function unjudgedRows(all, { cell, clip, limit = 4 }) {
  const closes = (all || []).filter((r) => r.id && r.session);
  return (all || []).filter((r) => r.kind === 'unevaluated' && r.prompt && !closes.some((c) => c.session === r.session && Date.parse(c.at) > Date.parse(r.at)))
    .slice(-limit).map((r) => clip(`- not evaluated · ${r.agent ? `${cell(r.agent)} ` : ''}${new Date(r.at).toLocaleString('sv').slice(0, 16)} · "${clip(cell(r.prompt), 80)}" · ${cell(String(r.cause || '').replace(/^unevaluated:/, ''))}`, 200));
}
