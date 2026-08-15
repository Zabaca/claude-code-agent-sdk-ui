/**
 * The vendored Brainless components, and the one container that is ours.
 *
 * Every component here keeps upstream's presentational contract — props in,
 * callbacks out, no knowledge of a Session — so re-syncing with upstream stays
 * possible. Each file records the commit it was taken from.
 *
 * `ClaudePermission` is deliberately absent: permission prompts are not part of
 * v0.1 (ADR-0003).
 *
 * The matching stylesheet is `@zabaca/claude-code-agent-sdk-ui/styles.css`,
 * precompiled and prefixed — importing it is all the styling setup there is.
 */
export { ClaudeDiff, type DiffLine } from "./claude-diff.tsx";
export { ClaudeHeader, ClaudeLogo } from "./claude-header.tsx";
export { ClaudeMessage } from "./claude-message.tsx";
export {
  ClaudePrompt,
  EFFORT_CYCLE,
  MODE_CYCLE,
  type ClaudeEffort,
  type ClaudeMode,
} from "./claude-prompt.tsx";
/**
 * `ClaudeSession` is the exception, and a deliberate one: a thin container we
 * wrote rather than vendored, so it carries no drift cost and may know what a
 * Session is. Using it is optional — every component above stays usable on its
 * own, with literal props and no Session anywhere.
 */
export { ClaudeSession } from "./session.tsx";
export { ClaudeSlashMenu, type SlashCommand } from "./claude-slash-menu.tsx";
/**
 * Threads, for a host that draws its own Transcript rather than using
 * `ClaudeSession`. `arrange` is the flat-Transcript decision the spec leaves to
 * the renderer — inline, nested or filtered out — and `useThreads` is the meter
 * behind it. Ours, like `ClaudeSession`, and for the same reason.
 */
export {
  arrange,
  REAL_CLOCK,
  ThreadMeters,
  ThreadTag,
  threadsOf,
  useThreads,
  type Arranged,
  type ThreadClock,
  type ThreadDisplay,
  type ThreadReading,
  type ThreadSource,
  type ThreadState,
} from "./thread.tsx";
export { ClaudeThinking } from "./claude-thinking.tsx";
export { ClaudeTodoList, type Todo } from "./claude-todo-list.tsx";
export { ClaudeToolCall } from "./claude-tool-call.tsx";
