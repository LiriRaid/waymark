// The task ID format (`YYYY-MM-DD · T<n>[a-z]`) and the small helpers every provenance module shares.


export const ID = /\b(20\d\d-\d\d-\d\d) · T(\d+)([a-z]?)\b/;

export const clip = (s, n) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);

export const idOrder = (id) => { const m = String(id).match(ID); return m ? `${m[1]}·${String(m[2]).padStart(4, '0')}${m[3]}` : ''; };

export const localDay = (now) => now.toLocaleDateString('sv'); // YYYY-MM-DD in local time
export const base = (id) => { const m = String(id).match(ID); return m ? `${m[1]} · T${m[2]}` : null; };
