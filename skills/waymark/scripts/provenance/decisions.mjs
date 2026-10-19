// The choices the user made in the choice window, as the log keeps them.
import { isPrompt, promptText } from '../transcript.mjs';
import { clip } from './ids.mjs';
import { maskSecrets } from './secrets.mjs';
import { optionAttrs } from './derive.mjs';

// Choices the user made in the choice window (Claude Code: AskUserQuestion → toolUseResult.{questions, answers}).
// A window the user rejected ("User rejected tool use") is answered by their next message: that message is their
// decision, recorded as written (source "reply") and placed where the window was asked.
export function decisionsIn(lines) {
  const out = [], asks = new Map();
  let rejected = null;
  for (const d of lines) {
    if (d.type === 'assistant' && !d.isSidechain) for (const c of Array.isArray(d.message?.content) ? d.message.content : []) if (c.type === 'tool_use' && c.name === 'AskUserQuestion') asks.set(c.id, c.input?.questions || []);
    const r = d.toolUseResult;
    if (rejected && isPrompt(d)) {
      const q = rejected.questions[0];
      const x = { question: q?.question || '(choice window)', chosen: answerText(promptText(d).trim()), discarded: [], source: 'reply' }; // masked like any free-text answer
      Object.defineProperty(x, 'callId', { value: rejected.id, enumerable: false });
      out.push(x);
      rejected = null;
      continue;
    }
    // Claude Code 2.1.x: "User rejected tool use", or "Error: The user doesn't want to proceed…" when the user chose to clarify
    if (d.type === 'user' && !d.isSidechain && typeof r === 'string' && /^User rejected tool use|doesn't want to proceed with this tool use/.test(r)) {
      const id = (Array.isArray(d.message?.content) ? d.message.content : []).find((c) => c.type === 'tool_result')?.tool_use_id;
      if (asks.has(id)) rejected = { id, questions: asks.get(id) };
      continue;
    }
    if (d.type !== 'user' || d.isSidechain || !r || !Array.isArray(r.questions) || !r.answers) continue;
    const callId = (Array.isArray(d.message?.content) ? d.message.content : []).find((c) => c.type === 'tool_result')?.tool_use_id;
    for (const q of r.questions) {
      const chosen = r.answers[q.question];
      if (chosen === undefined) continue;
      // A multi-select answer joins the labels with "," (observed on Claude Code 2.1.x): exact match per part; a label that
      // itself holds a comma falls back to a substring match.
      const parts = String(chosen).split(',').map((s) => s.trim());
      const picked = (l) => parts.includes(l) || (l.includes(',') && String(chosen).includes(l));
      const d = { question: q.question, chosen, discarded: (q.options || []).map((o) => o.label).filter((l) => !picked(l)), ...(r.source ? { source: r.source } : {}) }; // source "chat": asked in the chat (agents without a choice window, docs/adr/0009)
      Object.defineProperty(d, 'labels', { value: (q.options || []).map((o) => o.label), enumerable: false }); // for recordedDecisions only
      Object.defineProperty(d, 'optionList', { value: q.options || [], enumerable: false }); // the options with their descriptions: record schema v2 keeps their attributes
      // the choice-window call that asked it, to place it before or after the task's first change (testigo decision)
      Object.defineProperty(d, 'callId', { value: callId, enumerable: false });
      out.push(d);
    }
  }
  return out;
}

// Decisions as the chained log keeps them: the picked labels, and a free-text answer as written, at most 200
// characters, with passwords, tokens, keys, URL credentials and e-mail addresses masked (a chained record cannot be
// edited later).
const answerText = (s) => clip(maskSecrets(s).replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, '[correo]'), 200);
export function recordedDecisions(decisions = []) {
  return (decisions || []).map((d) => {
    if (!d.labels) return d; // built by hand (tests, older callers): no options known; decisionsIn always sets them
    const labels = d.labels, chosen = String(d.chosen ?? '');
    const kept = labels.includes(chosen) ? chosen
      : chosen.split(',').map((p) => p.trim()).filter(Boolean).map((p) => (labels.includes(p) ? p : answerText(p))).join(', ');
    return { ...d, chosen: kept, ...(d.optionList?.length ? { options: d.optionList.map(optionAttrs) } : {}) };
  });
}

export const askedChoice = (lines) => lines.some((d) => d.type === 'assistant' && !d.isSidechain && (d.message?.content || []).some?.((c) => c.type === 'tool_use' && c.name === 'AskUserQuestion'));
