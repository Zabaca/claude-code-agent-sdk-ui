/**
 * What counts as a picture this system will hold.
 *
 * Four places ask it: the composer refusing a paste, the handler refusing an
 * Event, the host minting a handle, and replay standing in for the last two.
 * Each had its own answer, and they were not the same answer — replay took
 * anything whose fields were strings, so it minted and drew handles for media
 * types the handler answers 400 to.
 *
 * Here rather than in the server for the reason {@link ./partial.ts} gives:
 * every one of those four speaks it, and `ui` is a published entry point that
 * has no business importing `server` to find out.
 *
 * The media type arrives on the wire, so it is attacker-shaped in exactly the
 * way a stored-XSS hole wants: a `text/html` "image" served back from the
 * handler's own origin is a script running where the Session lives. Nothing
 * outside {@link HOLDABLE} is held, anywhere, by anything.
 */

/** What a held image may be served as. */
export const HOLDABLE: ReadonlySet<string> = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
])

/** Bytes the host is holding, and the type it will serve them as. */
export type HeldImage = {
  /** Always one of {@link HOLDABLE} — never whatever arrived on the wire. */
  mediaType: string
  bytes: Uint8Array
}

/**
 * What this would be held as, or nothing.
 *
 * Returns the held form rather than a boolean so that the gate and the hold are
 * one act: a caller that has asked cannot then hold something else, and a
 * caller that only wants the answer ignores the value.
 */
export function holdable(image: {
  mediaType?: string | undefined
  data?: string | undefined
}): HeldImage | undefined {
  const mediaType = image.mediaType
  if (mediaType === undefined || !HOLDABLE.has(mediaType)) return undefined
  const bytes = bytesOf(image.data)
  return bytes ? { mediaType, bytes } : undefined
}

/** Base64 in, bytes out. Anything that is not base64 is not an image. */
export function bytesOf(data: string | undefined): Uint8Array | undefined {
  if (data === undefined || data === '') return undefined
  try {
    const binary = atob(data)
    const bytes = new Uint8Array(binary.length)
    for (let at = 0; at < binary.length; at++) bytes[at] = binary.charCodeAt(at)
    return bytes.length > 0 ? bytes : undefined
  } catch {
    return undefined
  }
}
