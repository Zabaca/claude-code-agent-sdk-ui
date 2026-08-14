/**
 * What a composer says about how the runtime is being asked to work: the
 * permission mode it is in, and how hard the model is being asked to think.
 *
 * Here rather than in `ui` because both ends need the vocabulary and neither
 * should depend on the other — the hook derives a mode from what the runtime
 * reports having loaded, and the component draws it. `ui/claude-prompt.tsx`
 * re-exports both, so the vendored component's contract is unchanged.
 *
 * The glyphs, colours and cycle order that go with these live with the
 * component, because they are how it looks rather than what it means.
 */

/** The permission modes Claude Code cycles through with shift+tab. */
export type ClaudeMode = 'auto' | 'manual' | 'accept-edits' | 'plan'

/** The efforts `/effort` steps through, in the order it steps through them. */
export type ClaudeEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'ultracode'
