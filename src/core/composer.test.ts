import { describe, expect, test } from 'bun:test'

import { draft, forgetImage, IMAGE_MARKER, imageMarker, type Draft, type Pasted } from './composer.ts'

test('a marker is one-based, because a person reads it first', () => {
  expect(imageMarker(0)).toBe('[Image #1]')
  expect(imageMarker(1)).toBe('[Image #2]')
  // Past a single digit, where a lazier format would run out.
  expect(imageMarker(11)).toBe('[Image #12]')
})

test('the marker pattern finds every marker in a sentence', () => {
  const found = [...'why is [Image #1] clipped and [Image #10] not'.matchAll(IMAGE_MARKER)]
  expect(found.map((one) => one[1])).toEqual(['1', '10'])
})

test('taking a picture back takes its marker and renumbers the ones above it', () => {
  // The pictures that are left renumber, so the words have to as well: a draft
  // still saying [Image #3] beside a tray holding two is a sentence about a
  // picture that is not being sent.
  expect(forgetImage('compare [Image #1] with [Image #2] and [Image #3]', 0)).toBe(
    'compare with [Image #1] and [Image #2]',
  )
  // From the middle: below it is untouched, above it comes down one.
  expect(forgetImage('compare [Image #1] with [Image #2] and [Image #3]', 1)).toBe(
    'compare [Image #1] with and [Image #2]',
  )
  // And from the end.
  expect(forgetImage('compare [Image #1] with [Image #2] and [Image #3]', 2)).toBe(
    'compare [Image #1] with [Image #2] and ',
  )
})

test('a marker named twice is renumbered in both places', () => {
  // Nothing stops a person mentioning the same picture twice, and a rename
  // that fixed only the first would leave the second pointing elsewhere.
  expect(forgetImage('[Image #2] is what [Image #1] should look like, see [Image #2]', 0)).toBe(
    '[Image #1] is what should look like, see [Image #1]',
  )
})

test('words with no markers in them come back untouched', () => {
  // The composer calls this on every removal, including from a draft the
  // person wrote entirely by hand.
  expect(forgetImage('why is this button clipped', 0)).toBe('why is this button clipped')
  expect(forgetImage('', 3)).toBe('')
})

test('the space after a marker goes with it, and no other space does', () => {
  // Breakage this fails on: removing the marker alone, which leaves "look at
  // here" with two spaces in it — small, and it accumulates over a
  // conversation of pastes and undos.
  expect(forgetImage('look at [Image #1] here', 0)).toBe('look at here')
  expect(forgetImage('look at [Image #1]here', 0)).toBe('look at here')
  // Two spaces before the marker were the person's; only the one after it was
  // the composer's to take.
  expect(forgetImage('look at  [Image #1] here', 0)).toBe('look at  here')
})

describe('a draft', () => {
  const shot = (name: string): Pasted => ({
    name,
    image: { mediaType: 'image/png', data: 'iVBORw0KGgo=' },
  })
  const empty: Draft = { text: '', pasted: [], refused: [] }

  test('takes words', () => {
    expect(draft(empty, { type: 'typed', text: 'why is this' })).toEqual({
      text: 'why is this',
      pasted: [],
      refused: [],
    })
  })

  test('writes a marker where the cursor was, not where it ended up', () => {
    // The caret is read before the bytes, because reading a file is a promise
    // and the cursor has moved by the time it resolves.
    const typed = draft(empty, { type: 'typed', text: 'why is this clipped' })

    expect(draft(typed, { type: 'pasted', pictures: [shot('a.png')], caret: 12 })).toEqual({
      text: 'why is this [Image #1] clipped',
      pasted: [shot('a.png')],
      refused: [],
    })
  })

  test('numbers a second paste from what is already attached', () => {
    const one = draft(
      draft(empty, { type: 'typed', text: 'compare and ' }),
      { type: 'pasted', pictures: [shot('a.png')], caret: 8 },
    )
    const two = draft(one, { type: 'pasted', pictures: [shot('b.png')], caret: 23 })

    expect(two.text).toBe('compare [Image #1] and [Image #2] ')
    expect(two.pasted.map((one) => one.name)).toEqual(['a.png', 'b.png'])
  })

  test('numbers two pastes in a row correctly, whoever has re-rendered', () => {
    // Counted from the state being reduced rather than from a render's copy of
    // it, so two pastes landing before React has drawn either still number 1
    // and 2 — and a reducer run twice for one paste still numbers it once.
    const once = draft(empty, { type: 'pasted', pictures: [shot('a.png')], caret: 0 })

    expect(draft(once, { type: 'pasted', pictures: [shot('b.png')], caret: 11 }).text).toBe(
      '[Image #1] [Image #2] ',
    )
    expect(draft(empty, { type: 'pasted', pictures: [shot('a.png')], caret: 0 })).toEqual(once)
  })

  test('writes markers for several pictures pasted at once', () => {
    const both = draft(empty, {
      type: 'pasted',
      pictures: [shot('a.png'), shot('b.png')],
      caret: 0,
    })

    expect(both.text).toBe('[Image #1] [Image #2] ')
  })

  test('writes no marker for a paste that held nothing', () => {
    // A marker for a picture nobody is holding is a sentence pointing at
    // nothing.
    const typed = draft(empty, { type: 'typed', text: 'look' })

    expect(draft(typed, { type: 'pasted', pictures: [], caret: 4 })).toEqual(typed)
  })

  test('puts the marker at the end when the caret is past the words', () => {
    const typed = draft(empty, { type: 'typed', text: 'look' })

    expect(draft(typed, { type: 'pasted', pictures: [shot('a.png')], caret: 999 }).text).toBe(
      'look[Image #1] ',
    )
  })

  test('renumbers the words when a picture is taken back', () => {
    // A draft still saying [Image #2] beside a tray holding one picture is a
    // sentence about something that is not being sent.
    const two = draft(
      draft(
        draft(empty, { type: 'typed', text: 'compare and ' }),
        { type: 'pasted', pictures: [shot('a.png')], caret: 8 },
      ),
      { type: 'pasted', pictures: [shot('b.png')], caret: 23 },
    )
    const gone = draft(two, { type: 'removed', at: 0 })

    expect(gone.text).toBe('compare and [Image #1] ')
    expect(gone.pasted.map((one) => one.name)).toEqual(['b.png'])
  })

  test('remembers what it would not hold, and forgets it when words are sent', () => {
    const said = draft(empty, { type: 'refused', types: ['image/svg+xml'] })

    expect(said.refused).toEqual(['image/svg+xml'])
    expect(draft(said, { type: 'cleared' })).toEqual(empty)
  })

  test('sends the pictures away with the words', () => {
    // Left behind they would go again with the next Turn — the composer
    // showing one thing and the wire carrying another.
    const held = draft(
      draft(empty, { type: 'pasted', pictures: [shot('a.png')], caret: 0 }),
      { type: 'refused', types: ['text/html'] },
    )

    expect(draft(held, { type: 'cleared' })).toEqual(empty)
  })
})
