'use client'

import * as React from 'react'

import type { SlashCommandInfo } from '../core/frame.ts'
import type {
  CompactedMessage,
  HookMessage,
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
import {
  arrange,
  hueOf,
  threadOf,
  ThreadMeters,
  ThreadTag,
  useThreads,
  type Arranged,
  type ThreadClock,
  type ThreadDisplay,
  type ThreadReading,
} from './thread.tsx'

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
  threads = 'inline',
  clock,
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
  /**
   * Where a Thread's Messages go: in Transcript order, grouped under the `Task`
   * call that opened them, or left out. The Transcript is flat precisely so
   * this stays the renderer's decision rather than `reduce`'s.
   */
  threads?: ThreadDisplay
  /**
   * What the Thread meters time themselves against. Injectable for the reason
   * the transport is: a duration driven by the wall clock is one a test cannot
   * pin. `core` is pure and carries no timestamps, so this is the renderer's
   * own clock — see the note at the top of `thread.tsx`.
   */
  clock?: ThreadClock
  className?: string
}) {
  const [text, setText] = React.useState('')
  /** Dismissed by esc, and only until the words change. */
  const [dismissed, setDismissed] = React.useState(false)
  const [highlighted, setHighlighted] = React.useState(0)
  const { transcript } = session
  const working = transcript.turn.status === 'working'
  const opened = useThreads(transcript.messages, clock)
  const byThread = new Map(opened.map((thread) => [thread.thread, thread]))

  // What the runtime advertises, narrowed to what has been typed. Derived every
  // render rather than held, so a `commands` Frame arriving mid-Session — a
  // skill the agent discovered while working in a subdirectory — is in the menu
  // the moment it lands, with nothing to invalidate.
  const offered = dismissed ? [] : matching(transcript.commands, text)
  const active = offered.length === 0 ? 0 : Math.min(highlighted, offered.length - 1)

  const say = (words: string) => {
    setText(words)
    setDismissed(false)
    setHighlighted(0)
  }

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
        {arrange(transcript.messages, threads).map((entry) => (
          // The Transcript is append-and-patch-the-tail, so a Message's index
          // is stable for as long as it is on screen.
          <Entry key={entry.at} entry={entry} threads={byThread} />
        ))}
      </div>

      {/* One meter per Thread, outside the Transcript on purpose: a background
          agent's progress is a fact about now, not an entry in the order, and
          it has to stay readable while the Transcript scrolls past it. */}
      <ThreadMeters threads={opened} />

      {/* Claude Code's working line, driven by real Turn state rather than by
          a timer of the container's own. */}
      {working ? <ClaudeThinking running /> : null}

      {session.error !== undefined ? (
        <div role="alert" style={{ color: 'var(--cc-error)' }}>
          {session.error}
        </div>
      ) : null}

      <SlashMenu commands={offered} active={active} onHighlight={setHighlighted} />

      <ClaudePrompt
        value={text}
        onChange={(event) => say(event.target.value)}
        onKeyDown={(event) => {
          if (offered.length === 0) return
          const chosen = offered[active]

          if (event.key === 'ArrowDown') {
            event.preventDefault()
            setHighlighted((at) => (at + 1) % offered.length)
          } else if (event.key === 'ArrowUp') {
            event.preventDefault()
            setHighlighted((at) => (at - 1 + offered.length) % offered.length)
          } else if ((event.key === 'Enter' || event.key === 'Tab') && !event.shiftKey && chosen) {
            // Takes the highlighted command instead of sending. Sending `/c`
            // would run a command nobody has, and would do it while a menu was
            // on screen saying `/c` is not yet one. `preventDefault` is what
            // `ClaudePrompt` reads to know its own submit was spoken for.
            event.preventDefault()
            say(`/${bare(chosen.name)} `)
          } else if (event.key === 'Escape') {
            // The Session binds esc to interrupt. While a menu is open esc is
            // the menu's, so dismissing a palette does not kill the Turn behind
            // it — which is why this stops here rather than bubbling.
            event.preventDefault()
            event.stopPropagation()
            setDismissed(true)
          }
        }}
        onSubmit={(value) => {
          // `send` is what decides whether these words start a Turn — the
          // container does not second-guess it — but the composer is emptied
          // either way, as the terminal's is.
          session.send(value)
          say('')
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
 * The slash palette: what the runtime advertises, narrowed to what is typed.
 *
 * Sending a slash command was always free — it is text that starts with `/` —
 * so what is delivered here is discovery: the argument hint says what to type
 * after the name, and the aliases say that `/cost` and `/usage` are the same
 * thing. A name alone says a command exists and nothing about using it.
 *
 * Drawn here rather than by the vendored `ClaudeSlashMenu`, which stays exported
 * and usable on its own. Upstream's menu renders a `ClaudePrompt` of its own and
 * takes no `value` or `onSubmit`, so putting it in a live Session would mean two
 * composers on screen, or one that cannot send. Wiring it would have meant
 * changing it. The rows keep its shape — its colour tokens and its fixed name
 * column — so the two read as one interface.
 */
const NAME_COLS = 22

function SlashMenu({
  commands,
  active,
  onHighlight,
}: {
  commands: SlashCommandInfo[]
  active: number
  onHighlight: (at: number) => void
}) {
  // No empty box: a palette offering nothing is a palette in the way.
  if (commands.length === 0) return null
  return (
    <ul
      role="listbox"
      aria-label="Slash commands"
      aria-activedescendant={`cc-slash-${active}`}
      className="cc:min-w-0 cc:space-y-0.5"
    >
      {commands.map((command, at) => (
        <li
          key={command.name}
          id={`cc-slash-${at}`}
          role="option"
          aria-selected={at === active}
          data-command={`/${bare(command.name)}`}
          onMouseEnter={() => onHighlight(at)}
          className="cc:min-w-0 cc:cursor-pointer cc:truncate cc:px-1 cc:py-0.5"
          style={{
            color: at === active ? 'var(--cc-slash-active)' : 'var(--cc-slash-inactive)',
          }}
        >
          <span className="cc:inline-block" style={{ width: `${NAME_COLS}ch` }}>
            /{bare(command.name)}
            {command.argumentHint === undefined ? null : ` ${command.argumentHint}`}
          </span>
          {command.description ?? ''}
          {command.aliases === undefined || command.aliases.length === 0 ? null : (
            <span style={{ color: 'var(--cc-fg-dim)' }}>
              {' '}
              (also {command.aliases.map((alias) => `/${bare(alias)}`).join(', ')})
            </span>
          )}
        </li>
      ))}
    </ul>
  )
}

/**
 * What the typed words are asking for. Nothing until a `/` starts them, and
 * nothing again once the person is past the name and into the arguments — no
 * rule of its own is needed for that, because a command name has no space in
 * it, so nothing is a prefix of what has been typed any more.
 *
 * Aliases match as well as names, because a menu that only matched names would
 * leave `/cost` looking like a command that does not exist. The command found
 * is still the one that runs, which is what the row shows.
 */
function matching(commands: SlashCommandInfo[], text: string): SlashCommandInfo[] {
  if (!text.startsWith('/')) return []
  const typed = text.slice(1).toLowerCase()
  return commands.filter((command) =>
    [command.name, ...(command.aliases ?? [])].some((name) =>
      bare(name).toLowerCase().startsWith(typed),
    ),
  )
}

/**
 * A command's name without the `/` this draws itself.
 *
 * The SDK documents `SlashCommand.name` as carrying no leading slash, and
 * `classify` keeps whatever it was given rather than tidying it — a Frame is an
 * observation. The tidying belongs here, where the slash is drawn, and it is
 * done because getting it wrong is silent: a name that arrived as `/clear` is
 * not a prefix of anything anyone types, so the menu would answer every
 * keystroke with nothing at all rather than with a visible mistake.
 */
function bare(name: string): string {
  return name.startsWith('/') ? name.slice(1) : name
}

/**
 * One Message, drawn by kind.
 *
 * The `switch` is exhaustive and the fallback is visible on purpose: a Message
 * kind this container has no chrome for yet is still an entry a viewer can
 * see, so a Transcript never silently drops something the agent said. `image`
 * gets its real surface in #12; that is what `Undrawn` stands in for, not what
 * it should look like.
 */
function Entry({
  entry,
  threads,
}: {
  entry: Arranged
  threads: ReadonlyMap<string, ThreadReading>
}) {
  const drawn = draw(entry.message)
  const nested = entry.nested ?? []
  // A Message that draws nothing takes no room — an empty row is still the
  // screen holding space for something it will not explain. `draw` is what
  // decides that, and it does so in exactly one place: a recall that surfaced
  // nothing. Every other kind draws something, which is what keeps the golden
  // log's "nothing silently dropped" check honest.
  //
  // Unless it is nesting a Thread: an entry that draws nothing itself but is
  // holding a Thread's work has to stand, or dropping the row would drop the
  // work with it.
  if (drawn === null && nested.length === 0) return null
  return (
    <Attributed entry={entry} threads={threads}>
      {drawn}
      {nested.length === 0 ? null : (
        <div
          data-thread-nest={entry.message.kind === 'tool-call' ? entry.message.opens?.thread : ''}
          className="cc:mt-2 cc:flex cc:min-w-0 cc:flex-col cc:gap-2"
        >
          {nested.map((inner) => (
            <Entry key={inner.at} entry={inner} threads={threads} />
          ))}
        </div>
      )}
    </Attributed>
  )
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
    case 'hook':
      return <Hook message={message} />
    case 'image': // #12
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
 * A Message marked with the Thread it belongs to — or, for a `Task` call, with
 * the Thread it opened.
 *
 * Both carry the same marker, and that is the point: the `Task` line and every
 * line of the work it started read as one Thread, in one colour, under one
 * ordinal. Without it, three background agents' tool calls arrive in the
 * Transcript indistinguishable from the main agent's, which is the single trap
 * this whole surface exists to close.
 *
 * A Thread's work is also indented, so the main agent's own line of work stays
 * followable down the left edge.
 */
function Attributed({
  entry,
  threads,
  children,
}: {
  entry: Arranged
  threads: ReadonlyMap<string, ThreadReading>
  children: React.ReactNode
}) {
  const message = entry.message
  const thread = threadOf(message)
  const opens = message.kind === 'tool-call' ? message.opens?.thread : undefined
  const reading = threads.get(thread ?? opens ?? '')
  const tool = message.kind === 'tool-call' ? message.name : undefined

  return (
    <div
      {...(thread !== undefined ? { 'data-thread': thread } : {})}
      {...(opens !== undefined ? { 'data-opens': opens } : {})}
      {...(tool !== undefined ? { 'data-tool': tool } : {})}
      className={cn('cc:min-w-0', thread === undefined ? undefined : 'cc:border-l cc:pl-3')}
      style={
        thread === undefined
          ? undefined
          : { borderColor: reading ? hueOf(reading.ordinal) : 'var(--cc-rule)' }
      }
    >
      {reading === undefined ? null : <ThreadTag thread={reading} />}
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
 * for how a Turn ended. Being what everything downstream keys off, it is typed
 * rather than left open: a mistyped kind is a compile error here, not a
 * selector that silently matches nothing wherever someone later looks for it.
 */
type Divergence = Extract<Message['kind'], 'compacted' | 'reset' | 'recall' | 'hook'>

function Marker({
  kind,
  glyph,
  label,
  details = [],
  tone = 'var(--cc-fg-muted)',
  status,
}: {
  /**
   * Drawn from the Message vocabulary through `Extract`, so a kind renamed
   * there stops compiling here rather than quietly becoming an attribute
   * nothing matches.
   */
  kind: Divergence
  glyph: string
  label: string
  /** Whatever the runtime actually gave. Anything missing is simply absent. */
  details?: (string | undefined)[]
  tone?: string
  /** Where a marker has states of its own, as a hook does. */
  status?: string
}) {
  const said = details.filter((part): part is string => part !== undefined && part !== '')
  return (
    <div
      data-divergence={kind}
      {...(status !== undefined ? { 'data-status': status } : {})}
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

/**
 * Where a memory came from and what it says. The path alone would report only
 * that something arrived; the content is the thing the agent is now acting on,
 * and it is carried, so dropping it would leave a viewer told that context
 * appeared and not told what it was.
 */
function from(memory: RecalledMemory): string {
  const where = memory.scope === undefined ? memory.path : `${memory.path} (${memory.scope})`
  return memory.content === undefined ? where : `${where}: ${memory.content}`
}

/**
 * A hook firing, and what it said.
 *
 * A hook is the other party in the conversation: it runs on the agent's
 * behalf, and one that refuses rewrites what the agent was allowed to do. Left
 * silent, the Transcript shows a tool call that simply never happened and
 * never says who stopped it — so a hook that errored is drawn as an error and
 * keeps its own words, which are the only account of why.
 *
 * All three output channels are passed through rather than one being chosen:
 * which of them a hook wrote to is the hook's business, and picking for it is
 * how a refusal's reason goes missing.
 */
function Hook({ message }: { message: HookMessage }) {
  const failed = message.status === 'error'
  return (
    <Marker
      kind="hook"
      glyph="⚑"
      label={`Hook ${message.name}`}
      status={message.status}
      details={[
        message.status,
        message.hookEvent,
        message.output,
        message.stderr,
        message.stdout,
        message.exitCode === undefined ? undefined : `exit ${message.exitCode}`,
      ]}
      tone={failed ? 'var(--cc-error)' : 'var(--cc-fg-muted)'}
    />
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

