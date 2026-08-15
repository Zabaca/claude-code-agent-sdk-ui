/**
 * An Event is something a person or the runtime proposed — the counterpart to a
 * Frame, which is observed. It lives beside `frame.ts` because the two are one
 * vocabulary: `CONTEXT.md` defines each in terms of the other, and putting the
 * willed half in the transport would make the glossary a thing only the server
 * could see.
 *
 * The vocabulary is deliberately small. There are two Events, and neither
 * carries `cwd`, `tools`, `permissionMode` or `systemPrompt` — the client may
 * not name what runs (ADR-0001), and the way that is enforced is that there is
 * nowhere for it to be named. A composer offering to change the permission mode
 * is offering something no Event can ask for.
 */
export type AgentEvent = PromptEvent | InterruptEvent

/**
 * A person's words, willed into a Turn — and the pictures they pasted in with
 * them, which travel ahead of the words because a picture before the words
 * about it reads better to the model.
 *
 * The images are payloads rather than handles, and that is the one direction
 * the handle rule does not run in: a handle is something the **host** minted,
 * so a person handing over a screenshot has none to name yet. What comes back
 * down carries handles only.
 */
export type PromptEvent = { type: 'prompt'; text: string; images?: PromptImage[] }

/** A picture pasted into the composer, as it travels to the host. */
export type PromptImage = {
  /** Must be an image type the host will hold; anything else is refused. */
  mediaType: string
  /** Base64, without the `data:` prefix — this is a payload, not a URI. */
  data: string
}

/** Stop the Turn now running. A stop asked for is not a failure. */
export type InterruptEvent = { type: 'interrupt' }
