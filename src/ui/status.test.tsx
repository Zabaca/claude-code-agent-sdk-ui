import { expect, test } from 'bun:test'
import { render, screen } from '@testing-library/react'

import { reduce } from '../core/reduce.ts'
import type { Frame } from '../core/frame.ts'
import { SessionStatus } from './status.tsx'

/** What the line reads, as one string. */
function line(...frames: Frame[]): string {
  render(<SessionStatus transcript={reduce(frames)} />)
  return (document.querySelector('[data-status-line]')?.textContent ?? '').trim()
}

test('the two meters are drawn side by side, and never blended', () => {
  // The whole reason both are here: "how full is this conversation" and "how
  // much of my week is left" are different questions on different clocks. A
  // line that added them, or showed one under the other's name, would read as
  // a measurement while being neither.
  const said = line(
    { kind: 'harness', model: 'claude-opus-5[1m]', cwd: '/Users/you/Projects/zabaca/ui' },
    { kind: 'context', totalTokens: 260_000, maxTokens: 1_000_000, percentage: 26 },
    { kind: 'rate-limit', limitType: 'five_hour', utilization: 2 },
    { kind: 'rate-limit', limitType: 'seven_day', utilization: 9 },
  )

  expect(said).toContain('[claude-opus-5[1m]]')
  // The directory by the name a person calls it, as a shell prompt shows it —
  // the whole path is on the welcome box a few lines above.
  expect(said).toContain('ui')
  expect(said).not.toContain('/Users/you')
  expect(said).toContain('[260.0k/1000k] 26%')
  expect(said).toContain('| 5h:2% wk:9%')
})

test('both limits survive each other, because each has its own slot', () => {
  // Breakage this fails on: one `rateLimit` for every kind of limit, which is
  // what shipped. The five-hourly and the weekly arrive as separate events, so
  // the last one in was the only one on screen — and the label beside it was
  // whichever the screen had decided to call it.
  const said = line(
    { kind: 'rate-limit', limitType: 'five_hour', utilization: 2 },
    { kind: 'rate-limit', limitType: 'seven_day', utilization: 9 },
    { kind: 'rate-limit', limitType: 'five_hour', utilization: 3 },
  )

  // The newer five-hourly reading, and the weekly still there beside it.
  expect(said).toContain('5h:3%')
  expect(said).toContain('wk:9%')
  expect(said).not.toContain('2%')
})

test('a limit this build has not heard of keeps the name the runtime gave it', () => {
  // The rule `classify` follows on the way in: a log recorded against an SDK
  // this build has never seen still reads. Inventing a label, or dropping the
  // reading, would both be worse than the runtime's own word for it.
  expect(line({ kind: 'rate-limit', limitType: 'seven_day_pluto', utilization: 40 })).toBe(
    '| seven_day_pluto:40%',
  )
})

test('nothing the runtime has not said is drawn, and an empty line is no line', () => {
  // Every part is something reported. A status line that showed `0%` before
  // any reading arrived would be inventing the figure it exists to report —
  // and one that drew an empty row would take space to say nothing.
  render(<SessionStatus transcript={reduce([])} />)
  expect(document.querySelector('[data-status-line]')).toBe(null)

  // Half-reported is half-drawn: a window with no maximum shows what is in it
  // and does not divide by a number nobody sent.
  expect(line({ kind: 'context', totalTokens: 91_500 })).toBe('[91.5k]')
})

test('the effort reads as a control only where it is one', () => {
  // Drawn here because Claude Code's status line carries it — but it is only
  // a control where something is listening, and a control that changes what
  // the line says without changing what runs is the mode line's mistake.
  render(<SessionStatus transcript={reduce([])} effort="high" />)
  expect(screen.getByText(/effort: high/)).toBeDefined()
  expect(screen.queryByRole('button')).toBe(null)

  const cycled: string[] = []
  render(
    <SessionStatus transcript={reduce([])} effort="high" onEffortChange={() => cycled.push('x')} />,
  )
  const control = screen.getAllByRole('button')[0]
  expect(control).toBeDefined()
  control?.click()
  expect(cycled).toEqual(['x'])
})

test('a branch is drawn only when a host gives one', () => {
  // Nothing here can work one out: the SDK reports a `cwd` and knows nothing
  // about VCS. Inventing "main" would be the status line making up the fact it
  // exists to report.
  expect(line({ kind: 'harness', cwd: '/repo' })).toBe('repo')
  render(<SessionStatus transcript={reduce([{ kind: 'harness', cwd: '/repo' }])} branch="main" />)
  expect(screen.getAllByText('git:(main)')[0]).toBeDefined()
})
