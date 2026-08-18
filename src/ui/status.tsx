'use client'

import * as React from 'react'

import type { ClaudeEffort } from '../core/composer.ts'
import type { Transcript } from '../core/transcript.ts'
import { cn } from './lib/cn.ts'
import { thousands } from './thread.tsx'

/**
 * The Session's meters, on the line Claude Code keeps them on: under the
 * composer, above the mode line.
 *
 *     claude-code-agent-sdk-ui git:(main) [claude-opus-5[1m]] effort: high
 *     [310.0k/1000k] 31% | 5h:4% wk:9%
 *
 * Every part is something the runtime reported, or something the host handed
 * over. A part nobody has spoken about is absent rather than guessed at —
 * which is why this draws nothing at all until something has been said, and
 * why `branch` is a prop: no Frame carries a git branch, so the component
 * cannot know one, and inventing "main" would be the status line making up the
 * fact it exists to report.
 *
 * The two figures are deliberately side by side and deliberately not summed.
 * "How full is this conversation" and "how much of my week is left" are
 * different questions on different clocks, and a line that blended them would
 * read as a measurement while being neither.
 */
export function SessionStatus({
  transcript,
  effort,
  onEffortChange,
  branch,
  className,
}: {
  transcript: Transcript
  /** The composer's effort. Drawn here, as Claude Code's own status line does. */
  effort?: ClaudeEffort
  /** Given, the effort reads as the control it is and cycles on activation. */
  onEffortChange?: () => void
  /**
   * The checked-out branch, for a host that knows one. Nothing here can work
   * it out: the SDK reports a `cwd` and no VCS at all.
   */
  branch?: string
  className?: string
}) {
  const cwd = transcript.harness?.cwd
  const model = transcript.harness?.model
  const window = usage(transcript)
  const limits = rateLimits(transcript)

  const said =
    cwd !== undefined || model !== undefined || effort !== undefined || window !== undefined
  if (!said && limits.length === 0) return null

  return (
    <div
      data-status-line
      className={cn(
        'cc:flex cc:min-w-0 cc:flex-wrap cc:items-baseline cc:gap-x-2 cc:gap-y-1 cc:px-1 cc:text-[12px]',
        className,
      )}
      style={{ color: 'var(--cc-fg-dim)' }}
    >
      {here(cwd) === undefined ? null : (
        <span className="cc:min-w-0 cc:break-words" style={{ color: 'var(--cc-info)' }}>
          {here(cwd)}
        </span>
      )}
      {branch === undefined || branch === '' ? null : (
        <span style={{ color: 'var(--cc-fg-muted)' }}>git:({branch})</span>
      )}
      {model === undefined ? null : <span className="cc:min-w-0 cc:break-words">[{model}]</span>}
      {effort === undefined ? null : onEffortChange ? (
        <button
          type="button"
          // The same neutralising the composer's own controls do: no Preflight
          // ships in the stylesheet, so an untreated button is a raised grey
          // box with Arial in it sitting in the middle of the line.
          className="cc:m-0 cc:cursor-pointer cc:appearance-none cc:border-0 cc:bg-transparent cc:p-0 cc:[font:inherit] cc:text-inherit"
          onClick={onEffortChange}
        >
          effort: {effort}
        </button>
      ) : (
        <span>effort: {effort}</span>
      )}
      {window === undefined ? null : <span>{window}</span>}
      {limits.length === 0 ? null : <span>| {limits.join(' ')}</span>}
    </div>
  )
}

/**
 * Where the agent is working, by the name a person would use for it.
 *
 * The last segment and nothing else, as a shell prompt shows: the whole path
 * is on the welcome box a few lines above, and a status line that carried it
 * would push the meters off the end of the row.
 */
function here(cwd: string | undefined): string | undefined {
  if (cwd === undefined || cwd === '') return undefined
  return cwd.split('/').filter((part) => part !== '').at(-1) ?? '/'
}

/**
 * How full the context window is: what is in it, what it holds, and the share.
 *
 * The percentage is drawn only where the runtime gave one. Dividing the two
 * counts here would be the line inventing the very figure it reports, and
 * `maxTokens` is optional on the wire — so the division is not always there to
 * be done even when it looks like it is.
 */
function usage(transcript: Transcript): string | undefined {
  const context = transcript.context
  if (context === undefined) return undefined
  const used = tenths(context.totalTokens)
  const of = context.maxTokens === undefined ? used : `${used}/${thousands(context.maxTokens)}`
  return context.percentage === undefined ? `[${of}]` : `[${of}] ${Math.round(context.percentage)}%`
}

/**
 * A token count to a tenth of a thousand, which is how a status line writes
 * the figure that moves: `310.0k` rather than `310k`, so a Turn that added
 * four hundred tokens is visibly a Turn that added something.
 */
function tenths(count: number): string {
  return count < 1000 ? String(count) : `${(count / 1000).toFixed(1)}k`
}

/** What a runtime calls a limit, in the shorthand a status line has room for. */
const LIMIT_NAMES: Record<string, string> = {
  five_hour: '5h',
  seven_day: 'wk',
  seven_day_opus: 'wk opus',
  seven_day_sonnet: 'wk sonnet',
  seven_day_overage_included: 'wk overage',
  overage: 'overage',
}

/**
 * One reading per limit the runtime has reported, in a stable order.
 *
 * Sorted by name rather than by arrival, so the five-hourly does not swap
 * places with the weekly as events land — a figure that moves position while
 * you are reading it is a figure you have to read again.
 *
 * A limit type this build has not heard of keeps the runtime's own name, which
 * is the rule `classify` follows on the way in: a log recorded against an SDK
 * this build has never seen still reads.
 *
 * `utilization` is a percentage. The SDK's `/usage` shape says so of the same
 * field — "Percentage of the window used, 0-100" — and the rate-limit event's
 * own copy carries no note of its own.
 */
function rateLimits(transcript: Transcript): string[] {
  return Object.entries(transcript.rateLimits)
    .sort(([one], [two]) => one.localeCompare(two))
    .flatMap(([type, limit]) =>
      limit.utilization === undefined
        ? []
        : [`${LIMIT_NAMES[type] ?? type}:${Math.round(limit.utilization)}%`],
    )
}
