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
 *
 * What may be held at all is {@link holdable}, in `core`, because the composer
 * and replay ask the same question and must get the same answer.
 */

import { holdable, type HeldImage } from '../core/image.ts'

export type { HeldImage }

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
      const picture = holdable(image)
      if (!picture) return undefined
      const handle = fresh()
      held.set(handle, picture)
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
