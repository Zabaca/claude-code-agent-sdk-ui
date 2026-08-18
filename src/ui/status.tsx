'use client'

import * as React from 'react'

import type { ClaudeEffort } from '../core/composer.ts'
import type { Transcript } from '../core/transcript.ts'
import { cn } from './lib/cn.ts'
import { thousands } from './thread.tsx'

/**
 * The Session's meters, on one line above the composer.
 *
 * Claude Code's own status line, as far as this package can honestly fill it
 * in: where the agent is working, what model answered, how full the context
 * window is, and how much of the subscription is left. Everything here is
 * something the runtime reported — a part the runtime has not spoken about is
 * absent rather than guessed at, which is why this can be empty and draws
 * nothing when it is.
 *
 * Two things a terminal's status line has that this one cannot: the git branch,
 * which no Frame carries, and the effort, which is already a control two lines
 * below — a second readout of the same figure, inches from the one you can
 * click, is worse than one.
 *
 * The two figures are deliberately side by side and deliberately not summed.
 * "How full is this conversation" and "how much of my week is left" are
 * different questions on different clocks, and a line that blends them reads as
 * a measurement while being neither.
 */
export function SessionStatus({
  transcript,
  effort,
  className,
}: {
  transcript: Transcript
  /** Drawn only if a host asks for it; the composer's chip is the usual home. */
  effort?: ClaudeEffort
  className?: string
}) {
  const parts = [
    where(transcript.harness?.cwd),
    transcript.harness?.model,
    effort === undefined ? undefined : `effort: ${effort}`,
    window(transcript),
    ...limits(transcript),
  ].filter((part): part is string => part !== undefined)

  if (parts.length === 0) return null
  return (
    <div
      data-status-line
      className={cn(
        'cc:flex cc:min-w-0 cc:flex-wrap cc:items-baseline cc:gap-x-3 cc:gap-y-1 cc:px-1 cc:text-[12px]',
        className,
      )}
      style={{ color: 'var(--cc-fg-dim)' }}
    >
      {parts.map((part) => (
        <span key={part} className="cc:min-w-0 cc:break-words">
          {part}
        </span>
      ))}
    </div>
  )
}

/**
 * The working directory, shortened from the front.
 *
 * The tail is what identifies it — a terminal shows the repo and not the path
 * to it — and the whole path is on the welcome box a few lines above for
 * anyone who wants it.
 */
function where(cwd: string | undefined): string | undefined {
  if (cwd === undefined || cwd === '') return undefined
  const parts = cwd.split('/').filter((part) => part !== '')
  const tail = parts.slice(-2).join('/')
  return parts.length > 2 ? `…/${tail}` : `/${tail}`
}

/**
 * How full the context window is: what is in it, what it holds, and the share.
 *
 * The percentage is drawn only where the runtime gave one. Dividing the two
 * counts here would be this line inventing the very figure it exists to
 * report — and `maxTokens` is optional on the wire, so the division is not
 * always available even when it looks like it should be.
 */
function window(transcript: Transcript): string | undefined {
  const context = transcript.context
  if (context === undefined) return undefined
  const used = thousands(context.totalTokens)
  const of = context.maxTokens === undefined ? used : `${used}/${thousands(context.maxTokens)}`
  return context.percentage === undefined ? of : `${of} ${Math.round(context.percentage)}%`
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
 * you are reading it is a figure you have to re-read.
 *
 * A limit type this build has not heard of keeps the runtime's own name. It is
 * the same rule `classify` follows on the way in: a log recorded against an SDK
 * this build has never seen still reads.
 */
function limits(transcript: Transcript): (string | undefined)[] {
  return Object.entries(transcript.rateLimits)
    .sort(([one], [two]) => one.localeCompare(two))
    .map(([type, limit]) => {
      if (limit.utilization === undefined) return undefined
      return `${LIMIT_NAMES[type] ?? type}: ${Math.round(limit.utilization)}%`
    })
}
