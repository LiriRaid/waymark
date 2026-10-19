// What the agent drivers of the conformance suite share: where a skill lives, how a transcript file is written, and the Claude-shaped
// hook answers that Claude Code, Codex and OpenCode give.
import fs from 'node:fs';
import path from 'node:path';
import { SKILLS_DIR } from '../harness.mjs';

export const skillPath = (name) => path.join(SKILLS_DIR, name, 'SKILL.md').replace(/\\/g, '/');
export const procedurePath = (name) => path.join(SKILLS_DIR, name, 'procedures.md').replace(/\\/g, '/');

// Writes `rows` as the transcript file of the world (JSON lines) and returns its path.
export function writeRows(w, rows, name = 'transcript.jsonl') {
  const file = path.join(w.root, name);
  fs.writeFileSync(file, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  return file;
}

// The answer of a hook that speaks Claude Code's shapes (hookSpecificOutput, decision, systemMessage) → { context, deny, block, blockPrompt, notice }.
export function claudeShape(ev, r) {
  const j = r.json || {}, o = j.hookSpecificOutput || {};
  return {
    context: String(o.additionalContext || ''),
    deny: o.permissionDecision === 'deny' ? String(o.permissionDecisionReason || 'deny') : null,
    block: ev === 'stop' && j.decision === 'block' ? String(j.reason || '') : null,
    blockPrompt: ev === 'prompt' && j.decision === 'block' ? String(j.reason || '') : null,
    notice: String(j.systemMessage || ''),
  };
}

// The choice window as the Claude-shaped transcript says it: the call, then the line that answers it.
export const claudeAsk = (id, questions, picks, timestamp) => [
  { type: 'assistant', timestamp, message: { content: [{ type: 'tool_use', id, name: 'AskUserQuestion', input: { questions } }] } },
  { type: 'user', timestamp, message: { content: [{ type: 'tool_result', tool_use_id: id, content: 'answered' }] }, toolUseResult: { questions, answers: picks } },
];

// Every agent: the labels of a choice-window question as plain strings, for the formats that carry only labels.
export const labels = (q) => (q.options || []).map((o) => o.label);

// The options of a choice-window question as the agents' own formats carry them: the label and the description the agent wrote.
export const described = (q) => (q.options || []).map((o) => ({ label: o.label, ...(o.description ? { description: o.description } : {}) }));
