// Waymark versions: x.y.z with an optional pre-release suffix (2.0.20-dev). One place, so the card, `update` and the tests agree.

// The release a version leads to: a pre-release counts as the release it precedes (2.0.20-dev → 2.0.20).
export const release = (v) => String(v || '').trim().replace(/-[0-9A-Za-z.-]+$/, '');

const pre = (v) => { const m = String(v).trim().match(/-([0-9A-Za-z.-]+)$/); return m ? m[1].split('.') : null; };

// Is `a` newer than `b`? Numbers first; with the same numbers a pre-release is older than its release, and two pre-releases
// compare by identifier (numeric ones as numbers, the rest as text), as semver does.
export const newer = (a, b) => {
  const nums = (v) => release(v).split('.').map((x) => parseInt(x, 10) || 0);
  const pa = nums(a), pb = nums(b);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] > pb[i];
  const sa = pre(a), sb = pre(b);
  if (!sa || !sb) return !sa && !!sb;
  for (let i = 0; i < Math.max(sa.length, sb.length); i++) {
    if (sa[i] === undefined) return false;
    if (sb[i] === undefined) return true;
    if (sa[i] === sb[i]) continue;
    const na = /^\d+$/.test(sa[i]), nb = /^\d+$/.test(sb[i]);
    if (na && nb) return Number(sa[i]) > Number(sb[i]);
    if (na !== nb) return nb;
    return sa[i] > sb[i];
  }
  return false;
};
