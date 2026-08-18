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

import type { PromptImage } from './event.ts'

/**
 * The permission modes a composer can be in.
 *
 * The first four are what shift+tab cycles through. `bypass` is not one of
 * them: Claude Code does not let you cycle into it, it is chosen when the
 * runtime starts, and it is the mode where every tool runs without asking —
 * which is why it needs a name of its own rather than borrowing `auto`'s. The
 * SDK has its own `auto` mode that means something milder, so a composer that
 * drew `bypassPermissions` as "auto mode on" was naming a different mode the
 * runtime also has.
 */
export type ClaudeMode = 'auto' | 'manual' | 'accept-edits' | 'plan' | 'bypass'

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

/** A picture attached to the draft, and what to call it in the tray. */
export type Pasted = {
  name: string
  image: PromptImage
}

/**
 * What a composer is holding: the words, the pictures attached to them, and
 * what the last paste would not take.
 *
 * The three move together and cannot be reasoned about apart. A picture
 * attached without its marker written is a Turn carrying something the words
 * cannot name; a marker written for a picture that was never attached points at
 * nothing; and taking a picture back has to renumber the markers left behind or
 * the words describe a picture that is no longer in the request. Held as one
 * value with one way in, so none of those can be half-done.
 */
export type Draft = {
  text: string
  pasted: Pasted[]
  /** Media types the last paste would not hold, for telling the person. */
  refused: string[]
}

/** Everything that can happen to a draft. */
export type DraftEvent =
  /** The person typed, or a command was taken from the menu. */
  | { type: 'typed'; text: string }
  /**
   * Pictures were pasted and have finished reading.
   *
   * `caret` is where the cursor was **when the paste happened**, not where it is
   * now: reading a file is a promise and the cursor has moved by the time it
   * resolves. Past the end of the words it clamps, so a marker never lands
   * outside the sentence.
   */
  | { type: 'pasted'; pictures: Pasted[]; caret: number }
  /** A paste carried types the composer will not hold. */
  | { type: 'refused'; types: string[] }
  /** A picture was taken back out of the tray. */
  | { type: 'removed'; at: number }
  /** The words were sent. The pictures go with them. */
  | { type: 'cleared' }

/**
 * The draft after one thing has happened to it.
 *
 * Pure, and pure on purpose: the marker numbering is worked out from the state
 * being reduced rather than from a render's copy of it, so two pastes landing
 * before React has drawn either still number 1 and 2 — and a reducer React runs
 * twice for one paste still numbers it once, with no counting done outside
 * itself to be careful about.
 */
export function draft(state: Draft, event: DraftEvent): Draft {
  switch (event.type) {
    case 'typed':
      return { ...state, text: event.text }
    case 'pasted': {
      // A marker for a picture nobody is holding is a sentence pointing at
      // nothing, so a paste that read nothing changes neither the words nor
      // the tray.
      if (event.pictures.length === 0) return state
      const markers = event.pictures
        .map((_picture, at) => imageMarker(state.pasted.length + at))
        .join(' ')
      const at = Math.min(Math.max(event.caret, 0), state.text.length)
      return {
        ...state,
        text: `${state.text.slice(0, at)}${markers} ${state.text.slice(at)}`,
        pasted: [...state.pasted, ...event.pictures],
      }
    }
    case 'refused':
      return { ...state, refused: event.types }
    case 'removed':
      return {
        ...state,
        // The words follow the pictures.
        text: forgetImage(state.text, event.at),
        pasted: state.pasted.filter((_picture, index) => index !== event.at),
      }
    case 'cleared':
      return { text: '', pasted: [], refused: [] }
  }
}

/** A draft with nothing in it. */
export function emptyDraft(): Draft {
  return { text: '', pasted: [], refused: [] }
}
