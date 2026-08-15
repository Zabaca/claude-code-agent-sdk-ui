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

/**
 * Where a picture sits in the sentence about it.
 *
 * A composer writes one of these into the draft, at the cursor, when a picture
 * is pasted — so a person can say *"the button in [Image #1] is what [Image #2]
 * should look like"* and be understood. Without it every screenshot is "the
 * image", and a Turn carrying three of them has no way to say which is which:
 * the pictures travel in an array whose order the words cannot name.
 *
 * The format is Claude Code's own, which is the reason for it rather than a
 * coincidence — a person who has used the terminal already knows what it means,
 * and so does the agent reading the prompt. Zabaca's varnick reached the same
 * shape independently.
 *
 * One-based, because a person reads it before a parser does.
 */
export function imageMarker(at: number): string {
  return `[Image #${at + 1}]`
}

/** Every marker in a draft, for a host that wants to find them. */
export const IMAGE_MARKER = /\[Image #(\d+)\]/g

/**
 * The draft after the picture at `removed` is taken back.
 *
 * Its marker goes, and every marker above it comes down one — because the
 * pictures that are left renumber, and a draft still saying `[Image #3]` beside
 * a tray showing two is a sentence about a picture that is no longer there.
 * The trailing space goes with the marker, so removing the only picture from
 * "look at [Image #1] here" leaves "look at here" rather than a double gap.
 */
export function forgetImage(text: string, removed: number): string {
  const gone = removed + 1
  return text.replace(/\[Image #(\d+)\]( ?)/g, (whole: string, digits: string, space: string) => {
    const at = Number(digits)
    if (at === gone) return ''
    return at > gone ? `[Image #${at - 1}]${space}` : whole
  })
}
