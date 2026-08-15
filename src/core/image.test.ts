import { describe, expect, test } from 'bun:test'

import { HOLDABLE, holdable } from './image.ts'

/**
 * One question — "is this a picture this system will hold?" — asked in four
 * places: the composer refusing a paste, the handler refusing an Event, the
 * host minting a handle, and replay standing in for all three.
 *
 * They disagreed. Replay checked that the fields were strings and nothing else,
 * so it would mint and draw a handle for a media type the handler answers 400
 * to — replay disagreeing with live about what a paste is, which is the one
 * thing that transport exists not to do.
 */
describe('what counts as a picture', () => {
  const png = { mediaType: 'image/png', data: btoa('\x89PNG\r\n\x1a\n') }

  test('holds the four types a browser will draw', () => {
    expect([...HOLDABLE].sort()).toEqual(['image/gif', 'image/jpeg', 'image/png', 'image/webp'])
  })

  test('holds a picture, and says what it would be held as', () => {
    const held = holdable(png)

    expect(held?.mediaType).toBe('image/png')
    expect(held?.bytes.length).toBeGreaterThan(0)
  })

  test('refuses a type the host would serve back as something executable', () => {
    // The stored-XSS shape: a `text/html` "image" served from the handler's own
    // origin is a script running where the Session lives. SVG is the same hole
    // wearing an image type.
    expect(holdable({ ...png, mediaType: 'text/html' })).toBeUndefined()
    expect(holdable({ ...png, mediaType: 'image/svg+xml' })).toBeUndefined()
    expect(holdable({ ...png, mediaType: 'application/javascript' })).toBeUndefined()
  })

  test('refuses a picture with nothing in it', () => {
    // A handle that resolves to nothing is worse than no handle: it is a
    // Message promising a picture the host cannot produce.
    expect(holdable({ mediaType: 'image/png', data: '' })).toBeUndefined()
    expect(holdable({ mediaType: 'image/png' })).toBeUndefined()
    expect(holdable({ data: png.data })).toBeUndefined()
    expect(holdable({})).toBeUndefined()
  })

  test('refuses a payload that is not base64', () => {
    // The check the handler's door was missing: it took the type on trust and
    // let the bytes through, so an unreadable payload was refused later by the
    // mint — after the Event had been accepted.
    expect(holdable({ mediaType: 'image/png', data: 'not base64 at all!!' })).toBeUndefined()
    expect(holdable({ mediaType: 'image/png', data: '%%%%' })).toBeUndefined()
  })
})
