import { expect, test } from 'bun:test'

import { forgetImage, IMAGE_MARKER, imageMarker } from './composer.ts'

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
