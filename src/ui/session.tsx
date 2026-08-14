'use client'

import * as React from 'react'

import type { Message, ToolCallMessage } from '../core/transcript.ts'
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
        onKeyDown={(event) => {
          // The working line says "esc to interrupt", so esc must interrupt.
          // Only while a Turn is running: an interrupt willed against an idle
          // Session is a request nobody made.
          if (event.key !== 'Escape' || !working) return
          event.preventDefault()
          session.interrupt()
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
  return <Attributed message={message}>{draw(message)}</Attributed>
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
    case 'image': // #12
    case 'compacted': // #10
    case 'reset': // #10
    case 'recall': // #10
    case 'hook': // #10
    case 'outcome': // #10
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

