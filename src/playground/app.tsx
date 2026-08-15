'use client'

import * as React from 'react'

import { useAgentSession, type AgentSessionOptions } from '../react/session.ts'
import { ClaudeHeader } from '../ui/claude-header.tsx'
import { ClaudeSession } from '../ui/session.tsx'
import { replayTransport, type ReplayTransport } from './replay.ts'

/**
 * The playground, in the two modes the spec asks for — the same UI, the same
 * hook, the same `reduce`, differing only in where the Frames come from.
 *
 * *Replay* plays a scripted Frame log through the hook's injectable transport:
 * a reviewer sees every surface in seconds, with no credential and no tokens
 * spent. *Live* opens the handler's SSE stream and talks to a real agent.
 * Keeping them one code path is the point — a replay that ran through
 * machinery of its own would stop proving anything about live.
 */
export type PlaygroundMode = 'replay' | 'live'

export function Playground({
  mode,
  endpoint = '/agent',
  transport,
}: {
  mode: PlaygroundMode
  /** Where the handler is mounted, for live mode. */
  endpoint?: string
  /** Replay's transport. Injected by tests, which need to pace the script. */
  transport?: ReplayTransport
}) {
  // One transport for the life of the mode. Replay is never constructed in
  // live mode, so the script never runs against a real Session.
  const replay = React.useMemo(
    () => (mode === 'replay' ? (transport ?? replayTransport()) : undefined),
    [mode, transport],
  )

  const options: AgentSessionOptions = replay
    ? {
        endpoint: 'replay',
        createEventSource: replay.createEventSource,
        fetch: replay.fetch,
        // Replay stands in for every piece of transport, images included:
        // there is no host here to hold a picture, so replay holds its own.
        imageSrc: replay.imageSrc,
      }
    : { endpoint }

  const session = useAgentSession(options)
  const harness = session.transcript.harness

  return (
    <div style={page}>
      <div style={column}>
        <Switcher mode={mode} />
        <ClaudeSession
          session={session}
          placeholder={mode === 'replay' ? 'Ask replay anything' : 'Ask the agent anything'}
          header={
            <ClaudeHeader
              // Everything here is either what the runtime reported or a plain
              // statement about the playground. Nothing is invented: a welcome
              // box that made up an account would be the first thing on screen
              // that the package cannot stand behind.
              version={harness?.version ?? 'no harness reported yet'}
              user="you"
              model={harness?.model ?? 'no model reported yet'}
              org={
                mode === 'replay'
                  ? 'replay — a Frame log, played. No credential, no network, no tokens'
                  : 'live — a real agent, through the handler'
              }
              cwd={harness?.cwd ?? 'no cwd reported yet'}
              tips={[
                'Type a prompt and press Enter',
                'esc interrupts a running Turn',
                'Click a tool line to read its whole output',
              ]}
              whatsNew={[
                'Prose streams token by token, then settles into one Message',
                'A tool call is on screen from the moment it starts',
                'The mode line is inert: no Event can carry a mode change',
              ]}
            />
          }
        />
      </div>
    </div>
  )
}

/**
 * The two modes, as links rather than as state. Switching reloads the page,
 * which is also the cheapest demonstration that a reload replays the log
 * rather than losing the Session.
 */
function Switcher({ mode }: { mode: PlaygroundMode }) {
  return (
    <nav aria-label="playground mode" style={nav}>
      {(['replay', 'live'] as const).map((one) => (
        <a
          key={one}
          href={`?mode=${one}`}
          aria-current={one === mode ? 'page' : undefined}
          style={{
            ...tab,
            color: one === mode ? 'var(--cc-accent)' : 'var(--cc-fg-dim)',
            borderColor: one === mode ? 'var(--cc-accent)' : 'transparent',
          }}
        >
          {one}
        </a>
      ))}
      <span style={{ color: 'var(--cc-fg-dim)' }}>
        {mode === 'replay'
          ? 'nothing here talks to a model'
          : 'this one spends tokens, and needs a credential'}
      </span>
    </nav>
  )
}

// The page's own look. The package's stylesheet deliberately does not reset or
// paint its host, so the ground the components sit on is the host's to choose.
const page: React.CSSProperties = {
  minHeight: '100vh',
  background: '#1a1b26',
  padding: '24px 16px 64px',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
}

const column: React.CSSProperties = {
  margin: '0 auto',
  maxWidth: 880,
  display: 'flex',
  flexDirection: 'column',
  gap: 16,
}

const nav: React.CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  gap: 12,
  fontSize: 13,
}

const tab: React.CSSProperties = {
  textDecoration: 'none',
  borderBottom: '1px solid',
  padding: '2px 0',
}
