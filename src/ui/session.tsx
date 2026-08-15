'use client'

import * as React from 'react'

import type {
  CompactedMessage,
  Message,
  OutcomeMessage,
  RecallMessage,
  ToolCallMessage,
  TurnOutcome,
} from '../core/transcript.ts'
import type { RecalledMemory } from '../core/frame.ts'
import type { AgentSession } from '../react/session.ts'
import { ClaudeMessage } from './claude-message.tsx'
import { ClaudePrompt } from './claude-prompt.tsx'
import { ClaudeThinking } from './claude-thinking.tsx'
import { ClaudeToolCall } from './claude-tool-call.tsx'
import { cn } from './lib/cn.ts'

/**
 * `ClaudeSession` — the thin container that wires a Session to the components.
 *
 * Ours, not vendored, so it carries no drift cost against upstream Brainless
 * and is therefore the one thing here allowed to know what a Session is. The
 * eight components stay presentational and stay usable on their own; nothing
 * below reaches for anything but their published props.
 */
export function ClaudeSession({
  session,
  header,
  placeholder = 'Try "fix the flaky test"',
  className,
}: {
  session: AgentSession
  /**
   * Drawn above the Transcript. A slot rather than something derived, because
   * what a welcome box says — who you are, which organisation, which tips —
   * is the host's to state and not ours to invent from a harness Frame.
   */
  header?: React.ReactNode
  placeholder?: string
  className?: string
}) {
  const [text, setText] = React.useState('')
  const { transcript } = session
  const working = transcript.turn.status === 'working'

  return (
    <div
      className={cn(
        'cc:flex cc:min-w-0 cc:flex-col cc:gap-3 cc:font-mono cc:text-[13px]',
        className,
      )}
      style={{ color: 'var(--cc-fg)' }}
      onKeyDown={(event) => {
        // The working line says "esc to interrupt", so esc must interrupt —
        // and from anywhere in the Session, not only from the input, because
        // that is where a person's hands are after expanding a tool call.
        //
        // Only while a Turn is running: an interrupt willed against an idle
        // Session is a request nobody made.
        if (event.key !== 'Escape' || !working) return
        event.preventDefault()
        session.interrupt()
      }}
    >
      {header}

      <div role="log" className="cc:flex cc:min-w-0 cc:flex-col cc:gap-2">
        {transcript.messages.map((message, at) => (
          // The Transcript is append-and-patch-the-tail, so a Message's index
          // is stable for as long as it is on screen.
          <Entry key={at} message={message} />
        ))}
      </div>

      {/* Claude Code's working line, driven by real Turn state rather than by
          a timer of the container's own. */}
      {working ? <ClaudeThinking running /> : null}

      {session.error !== undefined ? (
        <div role="alert" style={{ color: 'var(--cc-error)' }}>
          {session.error}
        </div>
      ) : null}

      <ClaudePrompt
        value={text}
        onChange={(event) => setText(event.target.value)}
        onSubmit={(value) => {
          // `send` is what decides whether these words start a Turn — the
          // container does not second-guess it — but the composer is emptied
          // either way, as the terminal's is.
          session.send(value)
          setText('')
        }}
        placeholder={placeholder}
        mode={session.mode}
        effort={session.effort}
        onEffortChange={session.setEffort}
        // `onModeChange` is deliberately left unset, which is what makes the
        // mode line inert chrome. `session.mode` is what the runtime reported
        // having loaded, and ADR-0001 is enforced by the wire rather than
        // merely asserted: an `AgentEvent` is a prompt or an interrupt, so
        // there is no Event a mode change could travel on. Cycling it here
        // would change what the composer says without changing what runs —
        // a control that lies. It stays unset until such an Event exists.
      />
    </div>
  )
}

/**
 * One Message, drawn by kind.
 *
 * The `switch` is exhaustive and the fallback is visible on purpose: a Message
 * kind this container has no chrome for yet is still an entry a viewer can
 * see, so a Transcript never silently drops something the agent said. The
 * remaining kinds get their real surfaces in the tickets named below; this is
 * what stands in until then, not what they should look like.
 */
function Entry({ message }: { message: Message }) {
  const drawn = draw(message)
  // A Message that draws nothing takes no room — an empty row is still the
  // screen holding space for something it will not explain. `draw` is what
  // decides that, and it does so in exactly one place: a recall that surfaced
  // nothing. Every other kind draws something, which is what keeps the golden
  // log's "nothing silently dropped" check honest.
  if (drawn === null) return null
  return <Attributed message={message}>{drawn}</Attributed>
}

function draw(message: Message): React.ReactNode {
  switch (message.kind) {
    case 'prompt':
      return <ClaudeMessage role="user">{message.text}</ClaudeMessage>
    case 'text':
      return <ClaudeMessage role="assistant">{message.text}</ClaudeMessage>
    case 'reasoning':
      // Only ever present when the hook was asked for it: thinking is not an
      // answer, so it is out of the Transcript by default.
      return (
        <ClaudeMessage role="assistant" className="cc:italic cc:text-[var(--cc-fg-muted)]">
          {message.text}
        </ClaudeMessage>
      )
    case 'tool-call':
      return <ToolCall message={message} />
    case 'outcome':
      return <Outcome message={message} />
    case 'compacted':
      return <Compacted message={message} />
    case 'reset':
      return (
        <Marker
          kind="reset"
          glyph="⦸"
          // Not "compacted", and not softened. A reset is the harder thing:
          // nothing was kept, so a viewer reading "condensed" would be reading
          // a smaller loss than the one they had.
          label="Context reset — memory cleared, not summarised"
          details={[`new transcript ${message.transcriptId}`]}
          tone="var(--cc-pending)"
        />
      )
    case 'recall':
      // Decided here rather than inside `Recall`, because a component that
      // returns null still leaves behind the row it was drawn into — which is
      // a blank entry, not silence.
      return message.memories.length === 0 ? null : <Recall message={message} />
    case 'image': // #12
    case 'hook': // #10
      return <Undrawn kind={message.kind} />
    default: {
      // Exhaustive at compile time — a kind added to the vocabulary has to be
      // decided here — and still visible at run time, because a Transcript
      // that met something it did not expect must say so, not go blank.
      const unhandled: never = message
      return <Undrawn kind={(unhandled as Message).kind} />
    }
  }
}

/**
 * A Message whose Thread is marked, so sub-agent work is not mistaken for the
 * main agent's. Attribution only — what a Thread is *doing* is a meter, and
 * that is #9.
 */
function Attributed({ message, children }: { message: Message; children: React.ReactNode }) {
  const thread = 'thread' in message ? message.thread : undefined
  if (thread === undefined) return <div>{children}</div>
  return (
    <div
      data-thread={thread}
      className="cc:min-w-0 cc:border-l cc:pl-3"
      style={{ borderColor: 'var(--cc-rule)' }}
    >
      {children}
    </div>
  )
}

/**
 * How a Turn ended, where it ended.
 *
 * The three outcomes are drawn apart because `reduce` already tells them
 * apart. Drawn the same they would not be a gap but a claim the screen cannot
 * back up: a Turn that died would read exactly like one that finished, and the
 * reason it died — which the Message is carrying — would be thrown away in the
 * drawing. That is worse than saying nothing.
 *
 * Deliberately plain. The divergence markers are their own work; this is only
 * the part that must not lie.
 *
 * `interrupted` is drawn as an ending rather than as an error, and keeps the
 * runtime's account of the abort: a stop the person asked for is not a problem
 * they have, but what the runtime said about it is still worth reading.
 */
const ENDED: Record<TurnOutcome, string> = {
  settled: 'Turn settled',
  interrupted: 'Turn interrupted',
  failed: 'Turn failed',
}

function Outcome({ message }: { message: OutcomeMessage }) {
  const failed = message.outcome === 'failed'
  const why = failed
    ? [message.subtype, message.reason].filter((part) => part !== undefined).join(': ')
    : (message.reason ?? '')
  return (
    <div
      data-outcome={message.outcome}
      style={{ color: failed ? 'var(--cc-error)' : 'var(--cc-fg-dim)' }}
    >
      <span aria-hidden>⏺ </span>
      {ENDED[message.outcome]}
      {why === '' ? null : ` — ${why}`}
    </div>
  )
}

/**
 * A divergence marker: the line drawn where what the agent can see stopped
 * matching what the Transcript shows.
 *
 * These exist because silence is the bug. Nothing above this point looks any
 * different after a compaction, a reset or a recall — the Messages are all
 * still there — while the conversation the agent is actually holding has been
 * summarised, thrown away, or joined by something nobody in this Session said.
 * A marker is the only place a viewer can learn that.
 *
 * `data-divergence` is the machine-readable half, so a marker can be found and
 * told apart without reading prose — the same contract `data-outcome` carries
 * for how a Turn ended.
 */
function Marker({
  kind,
  glyph,
  label,
  details = [],
  tone = 'var(--cc-fg-muted)',
}: {
  kind: string
  glyph: string
  label: string
  /** Whatever the runtime actually gave. Anything missing is simply absent. */
  details?: (string | undefined)[]
  tone?: string
}) {
  const said = details.filter((part): part is string => part !== undefined && part !== '')
  return (
    <div
      data-divergence={kind}
      className="cc:flex cc:min-w-0 cc:flex-wrap cc:items-baseline cc:gap-2"
      style={{ color: tone }}
    >
      <span aria-hidden>{glyph}</span>
      <span className="cc:min-w-0">
        {label}
        {said.length === 0 ? null : ` — ${said.join(' · ')}`}
      </span>
    </div>
  )
}

/**
 * Where memory was replaced by a summary.
 *
 * The counts are the point: "compacted" alone says an event happened, while
 * `180,000 → 42,000` says how much of the conversation the agent no longer
 * has. They are optional on the wire, so each is drawn only where the SDK gave
 * it — a zero standing in for a number nobody sent would be the screen
 * inventing the very fact it exists to report.
 */
function Compacted({ message }: { message: CompactedMessage }) {
  return (
    <Marker
      kind="compacted"
      glyph="⇲"
      label="Context compacted — the agent is working from a summary"
      details={[message.trigger, counts(message), took(message.durationMs)]}
    />
  )
}

function counts(message: CompactedMessage): string | undefined {
  const before = message.preTokens
  const after = message.postTokens
  if (before !== undefined && after !== undefined) {
    return `${tokens(before)} → ${tokens(after)} tokens`
  }
  if (before !== undefined) return `${tokens(before)} tokens before`
  if (after !== undefined) return `${tokens(after)} tokens after`
  return undefined
}

/** Grouped by hand rather than by locale, so the same log reads the same anywhere. */
function tokens(count: number): string {
  return String(Math.round(count)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

function took(durationMs: number | undefined): string | undefined {
  return durationMs === undefined ? undefined : `took ${(durationMs / 1000).toFixed(1)}s`
}

/**
 * Where context arrived that nobody in this conversation said.
 *
 * A recall that surfaced nothing draws nothing — see `draw`, which is where
 * that is decided. It is the one silence here which is honest: no memory
 * entered the agent's context, so there is no divergence between what the
 * screen shows and what the agent can see, and a marker would be the screen
 * reporting an arrival that did not happen.
 */
function Recall({ message }: { message: RecallMessage }) {
  const found = message.memories
  return (
    <Marker
      kind="recall"
      glyph="⊕"
      label={
        found.length === 1
          ? 'Memory recalled — context from outside this conversation'
          : `${found.length} memories recalled — context from outside this conversation`
      }
      // Where each came from, because provenance is the whole claim: this text
      // is in the agent's context and no one here put it there.
      details={[message.mode, ...found.map(from)]}
      tone="var(--cc-info)"
    />
  )
}

function from(memory: RecalledMemory): string {
  return memory.scope === undefined ? memory.path : `${memory.path} (${memory.scope})`
}

/**
 * A Message kind with no chrome yet. Deliberately plain and deliberately
 * present: an entry a viewer can see is honest about the gap, where rendering
 * nothing would let the Transcript quietly lose what the agent said.
 */
function Undrawn({ kind }: { kind: Message['kind'] }) {
  return (
    <div data-kind={kind} style={{ color: 'var(--cc-fg-dim)' }}>
      ⋯ {kind}
    </div>
  )
}

/**
 * A tool call, drawn from the moment it starts. `status` is passed through
 * rather than defaulted, because `ClaudeToolCall` defaults to `success` and a
 * call still in flight drawn as a success is the screen saying the tool
 * answered when it has not.
 */
function ToolCall({ message }: { message: ToolCallMessage }) {
  const output = message.output
  const arg = argOf(message.input)
  const whole = output !== undefined && output.includes('\n') ? output : undefined
  return (
    <ClaudeToolCall
      tool={message.name}
      status={message.status}
      {...(arg !== undefined ? { arg } : {})}
      {...(output !== undefined ? { result: summarise(output) } : {})}
    >
      {whole}
    </ClaudeToolCall>
  )
}

/**
 * What Claude Code puts in the parentheses after a tool's name — the one field
 * of the call that says what it is about. Tried in the order the SDK's own
 * tools carry them; anything unrecognised falls back to the first string the
 * input holds, so a tool nobody here has heard of still says something.
 */
const ARG_KEYS = ['file_path', 'path', 'command', 'pattern', 'url', 'description', 'prompt']

function argOf(input: Record<string, unknown>): string | undefined {
  for (const key of ARG_KEYS) {
    const value = input[key]
    if (typeof value === 'string' && value !== '') return value
  }
  for (const value of Object.values(input)) {
    if (typeof value === 'string' && value !== '') return value
  }
  return undefined
}

/** The collapsed line: the first line, and how much more is behind it. */
function summarise(output: string): string {
  const lines = output.split('\n')
  const first = lines[0] ?? ''
  if (lines.length === 1) return first
  return `${first} +${lines.length - 1} lines`
}

