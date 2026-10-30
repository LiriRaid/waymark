// Waymark · supply chain of the agent's work (docs/adr/0001, 0002), shared by the hooks. Offline, 0 model tokens.
// - Task IDs `YYYY-MM-DD · T<n>[a-z]`: n per project and local day, a letter per follow-up prompt of the same task.
// - The record of a closed task, written by stop-hook.mjs from what the transcript proves (prompt, options asked and
//   the user's pick, files, commands, skills), the inputs it was built with (Waymark and agent version, model, MCP
//   servers, instruction file hashes), its commits (trailer `Waymark-Task: <id>`) and the Cierre text. Git is the
//   source of truth (docs/adr/0012): a task with a commit keeps its whole record as a git note on that commit
//   (notes.mjs) and <project>/.waymark/provenance.jsonl keeps a stub with the note's hash; a task without one keeps the
//   whole record there, and that line, as chained, also rides in git (refs/notes/waymark-log). A task committed in other
//   repos too gets the same note on its newest commit in each (`repos` on the record). Each line holds the hash of the
//   previous one: an edited or deleted record or note breaks the chain (verifyChain). Each record names its agent; a
//   question (kind "Q") is a short record with no task ID (docs/adr/0008). With no log (a clone, a cleaned project) the
//   records come from git: notes, log lines, and else the commits' `Waymark-Task` trailers (rebuildFromGit).
// - The live state: one line per task in memory.md → Work in progress, written by the end-of-turn hook from the Cierre
//   (writeTaskLine), and tasks.md generated from it and the records.
// - `note` on a log line is always the git-note pointer { commit, sha } (gitNote() reads it); other text uses other fields.
// Where: <project>/.waymark/ (docs/adr/0007), resolved once by projectHome() for every hook.
// The code lives in provenance/*.mjs, one module per concern; this file is the one place the hooks import it from.
export { ID } from './provenance/ids.mjs';
export {
  RECORD_SCHEMAS,
  RECORD_V1,
  RECORD_V2,
  TASK_TYPES,
  askedItems,
  followUps,
  askedGaps,
  itemsOf,
  optionAttrs,
  optionsLint,
  pedidoAnswers,
  pedidoItems,
  replayV2,
  reworkOf,
  taskTypeOf,
  v2Fields,
  windowCheck,
} from './provenance/derive.mjs';
export {
  INTERRUPTED_AFTER,
  RELAY_MARK,
  aprendidoOf,
  closeOpen,
  confirmTasks,
  expireOpen,
  markOpen,
  rebuildFromGit,
  readRelay,
  refreshTasks,
  taskSummary,
  tasksMarkdown,
  tidyWip,
  writeRelay,
  writeTaskLine,
} from './provenance/taskmd.mjs';
export {
  LOCAL_DIRS,
  PROBE_OK,
  ensureLocal,
  hookErrorsFile,
  legacyMemory,
  logFile,
  logHookError,
  projectHome,
  projectSlug,
  workspaceSiblings,
} from './provenance/project.mjs';
export {
  addRepoSnapshot,
  commitsFor,
  gitSnapshot,
  loadSnapshot,
  markPaused,
  saveSnapshot,
  snapshotDiff,
  turnChanged,
  turnInputs,
  pinnedRules,
} from './provenance/snapshot.mjs';
export {
  anchorsFor,
  appendRecord,
  forget,
  gitError,
  gitNote,
  logId,
  readLog,
  readNotes,
  readRecords,
  recordName,
  verifyChain,
} from './provenance/chain.mjs';
export {
  askedChoice,
  decisionsIn,
  recordedDecisions,
} from './provenance/decisions.mjs';
export {
  clearTaskStart,
  markTaskStart,
  openTurn,
  otherOpen,
  pendingSteps,
  taskFiles,
  taskIds,
  taskInProgress,
  pinnedCwd,
  taskLines,
  taskBlocks,
  noteTaskBlock,
  taskOffer,
  taskStart,
  taskStartMark,
  validId,
} from './provenance/tasks.mjs';
export {
  deepMask,
  findSecrets,
  maskSecrets,
} from './provenance/secrets.mjs';
export { readTaskRecords } from './provenance/records.mjs';

// The shell parsing (shellSkeleton, shellRuns, mutatesFiles, changesProject) lives in runs.mjs; re-exported for its importers.
export { shellSkeleton, mutatesFiles, shellRuns, changesProject } from './runs.mjs';
