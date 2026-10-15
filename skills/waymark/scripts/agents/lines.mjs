// What every adapter's toLines builds the same way: a choice-window question and the user line that answers it, in
// the shape the core reads (Claude Code's AskUserQuestion call and its toolUseResult).

// A question as the agent sent it → { question, options: [{ label }] }. `text` and `options` name the keys the agent
// uses, in order (the first with a value wins); `plain`: a bare string is the question itself.
export const asQuestion = (q, { text = ['question'], options = ['options'], plain = false } = {}) => ({
  question: String(text.map((k) => q?.[k]).find(Boolean) || (plain ? q : '') || '').trim(),
  options: (options.map((k) => q?.[k]).find(Boolean) || []).map((o) => ({ label: String(o?.label ?? o) })),
});

// The questions without what only the adapter needed (an id).
export const plainQuestions = (qs) => qs.map((q) => ({ question: q.question, options: q.options }));

// The user line that answers the choice-window call `id`; `extra` rides on the line itself (Codex's version).
export const answerLine = (timestamp, id, content, toolUseResult, extra = {}) => ({
  type: 'user', timestamp, ...extra,
  message: { content: [{ type: 'tool_result', tool_use_id: id, content }] },
  toolUseResult,
});

// The previous turn ended asking in the chat and this reply answers every question it asked.
export const chatAnswer = (questions, reply) => ({
  source: 'chat',
  questions: questions.map((question) => ({ question, options: [] })),
  answers: Object.fromEntries(questions.map((q) => [q, reply])),
});
