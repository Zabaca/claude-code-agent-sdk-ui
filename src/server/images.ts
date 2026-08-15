/**
 * Where a held image lives, and the whole of what a handle means.
 *
 * Forge's handle rule, and the reason for it: **a Message that could name a
 * location is a Message that could fetch from one.** So a Message names a
 * handle the host minted — never a path, never a URL, never a data URI — and
 * resolving one is a lookup in this map and nothing else.
 *
 * That last clause is the security property, and it is structural rather than
 * defensive. There is no path to sanitise because there is no path: the store
 * holds bytes, not locations, so a handle shaped like `../../etc/passwd` is a
 * key that is not in the map. Traversal has nothing to traverse. Nothing here
 * imports `node:fs` or `node:path`, and a test in `handler.test.ts` says so
 * statically, because the day someone rewrites this to hold temp-file paths is
 * the day the arithmetic comes back.
 *
 * A handle is minted **per hold**. Two holds of one file are two handles and
 * neither derives from the other — deliberately not content-addressed, because
 * a handle computed from the bytes is a handle anyone holding the same file can
 * compute, which turns "the host minted it" into "the client guessed it".
 *
 * One store per handler, so one per Session (ADR-0002). A handle from another
 * Session is a key this map never had, and resolves to nothing like any other.
 */

/** Bytes the host is holding, and the type it will serve them as. */
export type HeldImage = {
  /** Always one of {@link SERVABLE} — never whatever arrived on the wire. */
  mediaType: string
  bytes: Uint8Array
}

/**
 * What a held image may be served as.
 *
 * The media type arrives on the wire, so it is attacker-shaped in exactly the
 * way a stored-XSS hole wants: a `text/html` "image" served back from the
 * handler's own origin is a script running where the Session lives. Nothing
 * outside this list is ever minted, so a picture that is not a picture is not
 * held — and the handle that would have named it resolves to nothing, which is
 * the same answer every unminted handle gets.
 */
export const SERVABLE = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])

export type ImageStore = {
  /**
   * Holds an image and returns the handle naming it. `undefined` when there is
   * nothing holdable — no payload, an unservable type, or bytes that are not
   * base64 — because a handle that resolves to nothing is worse than no handle:
   * it is a Message promising a picture the host cannot produce.
   */
  mint(image: { mediaType: string | undefined; data: string | undefined }): string | undefined
  /** A map lookup. Not path arithmetic, and not a fetch. */
  resolve(handle: string): HeldImage | undefined
}

export function imageStore(): ImageStore {
  const held = new Map<string, HeldImage>()

  return {
    mint: (image) => {
      const mediaType = image.mediaType
      if (mediaType === undefined || !SERVABLE.has(mediaType)) return undefined
      if (image.data === undefined || image.data === '') return undefined
      const bytes = decode(image.data)
      if (!bytes) return undefined
      const handle = fresh()
      held.set(handle, { mediaType, bytes })
      return handle
    },
    // Every branch of "no" is the same "no". A handle nobody minted, a handle
    // shaped like a path, a handle from another Session: all absent from the
    // map, all answered identically, so nothing here reports whether something
    // exists somewhere else.
    resolve: (handle) => held.get(handle),
  }
}

/**
 * A fresh handle, from the platform's randomness. Unguessable and unrelated to
 * anything the client already knows — which is what stops a handle being
 * derived from a Session id, a filename or the bytes themselves.
 */
function fresh(): string {
  const random = new Uint8Array(16)
  crypto.getRandomValues(random)
  let hex = ''
  for (const byte of random) hex += byte.toString(16).padStart(2, '0')
  return `img_${hex}`
}

/** Base64 in, bytes out. Anything that is not base64 is not an image. */
function decode(data: string): Uint8Array | undefined {
  try {
    const binary = atob(data)
    const bytes = new Uint8Array(binary.length)
    for (let at = 0; at < binary.length; at++) bytes[at] = binary.charCodeAt(at)
    return bytes.length > 0 ? bytes : undefined
  } catch {
    return undefined
  }
}
