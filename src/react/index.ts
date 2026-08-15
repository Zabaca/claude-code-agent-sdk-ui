/**
 * The browser half: one hook that opens the handler's SSE stream, runs `reduce`
 * over the Frames arriving on it, and hands a composer the Transcript, `send`,
 * `interrupt`, and the mode and effort to draw.
 *
 * The transport is injectable — `createEventSource`, `fetch` and `imageSrc` —
 * for the same reason `createAgentHandler` takes a `createQuery`: the whole
 * surface can be driven with no network and no credential.
 */
export { useAgentSession } from './session.ts'
export type {
  AgentEventSource,
  AgentEventSourceFactory,
  AgentFetch,
  AgentServerEvent,
  AgentSession,
  AgentSessionOptions,
} from './session.ts'
