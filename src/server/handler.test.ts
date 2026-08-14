import { expect, test } from 'bun:test'

import type { ClassifyInput } from '../core/classify.ts'
import { fakeQuery } from './fake.ts'
import { createAgentHandler } from './handler.ts'

test('a Session streams Frames over SSE, each event carrying its index as id', async () => {
  const fake = fakeQuery()
  const handler = createAgentHandler({ createQuery: fake.createQuery })

  const stream = await handler(open())
  await handler(prompt('hello'))

  fake.say(init('session-abc'))
  fake.say(says('Hello there'))
  fake.say(settled())

  const events = await read(stream, 6)

  expect(events.map((event) => event.id)).toEqual(['0', '1', '2', '3', '4', '5'])
  expect(events.map((event) => event.name)).toEqual(Array(6).fill('frame'))
  expect(events.map((event) => event.data['kind'])).toEqual([
    'session',
    'harness',
    'commands',
    'text',
    'settled',
    'cost',
  ])
  expect(events[0]?.data).toEqual({ kind: 'session', sessionId: 'session-abc' })
})

// --- driving the seam ---------------------------------------------------------

const endpoint = 'http://localhost/agent'

function open(lastEventId?: string): Request {
  const headers = new Headers()
  if (lastEventId !== undefined) headers.set('last-event-id', lastEventId)
  return new Request(endpoint, { headers })
}

function prompt(text: string, extra: Record<string, unknown> = {}): Request {
  return new Request(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'prompt', text, ...extra }),
  })
}

type SseEvent = { id: string | undefined; name: string; data: Record<string, unknown> }

/** Reads exactly `count` SSE events off a response, then lets go of the stream. */
async function read(response: Response, count: number): Promise<SseEvent[]> {
  const body = response.body
  if (!body) throw new Error('the stream had no body')
  const reader = body.getReader()
  const decoder = new TextDecoder()
  const events: SseEvent[] = []
  let buffered = ''

  try {
    while (events.length < count) {
      const { value, done } = await reader.read()
      if (done) break
      buffered += decoder.decode(value, { stream: true })
      let split = buffered.indexOf('\n\n')
      while (split !== -1) {
        const event = parse(buffered.slice(0, split))
        buffered = buffered.slice(split + 2)
        if (event) events.push(event)
        split = buffered.indexOf('\n\n')
      }
    }
  } finally {
    await reader.cancel()
  }

  return events
}

function parse(raw: string): SseEvent | undefined {
  let id: string | undefined
  let name = 'message'
  let data: string | undefined

  for (const line of raw.split('\n')) {
    const at = line.indexOf(':')
    if (at <= 0) continue
    const field = line.slice(0, at)
    const value = line.slice(at + 1).trimStart()
    if (field === 'id') id = value
    if (field === 'event') name = value
    if (field === 'data') data = value
  }

  if (data === undefined) return undefined
  return { id, name, data: JSON.parse(data) as Record<string, unknown> }
}

// --- SDK messages the fake yields ---------------------------------------------

function init(sessionId: string): ClassifyInput {
  return {
    type: 'system',
    subtype: 'init',
    session_id: sessionId,
    model: 'claude-opus-4',
    cwd: '/work',
    permissionMode: 'bypassPermissions',
    tools: ['Read', 'Write'],
    slash_commands: ['compact'],
  }
}

function says(text: string): ClassifyInput {
  return {
    type: 'assistant',
    parent_tool_use_id: null,
    message: { role: 'assistant', content: [{ type: 'text', text }] },
  }
}

function settled(): ClassifyInput {
  return {
    type: 'result',
    subtype: 'success',
    result: 'Hello there',
    num_turns: 1,
    duration_ms: 12,
    total_cost_usd: 0.001,
  }
}
