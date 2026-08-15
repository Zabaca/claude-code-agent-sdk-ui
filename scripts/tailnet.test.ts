import { describe, expect, test } from 'bun:test'

import { decide, PLAYGROUND, parseServeStatus, type ServeStatus } from './tailnet.ts'

/**
 * The route is declared, so it can be checked without being applied.
 *
 * Everything here is a pure reading of what `tailscale serve status --json`
 * said. The one impure act — running the CLI — is the thing this leaves out,
 * because a test that shells out to tailscaled is a test that only passes on
 * one machine.
 */
const HOST = 'ryzen-9.tail18440.ts.net'

const served = (port: number, proxy: string): ServeStatus => ({
  TCP: { [String(port)]: { HTTPS: true } },
  Web: { [`${HOST}:${port}`]: { Handlers: { '/': { Proxy: proxy } } } },
})

describe('reading what is already served', () => {
  test('an unserved node is not an error', () => {
    // A node nobody has served prints `{}`, and some versions print `null`.
    // Reading either as a failure would make this refuse to run on a fresh box.
    expect(parseServeStatus('{}')).toEqual({})
    expect(parseServeStatus('')).toEqual({})
    expect(parseServeStatus('null')).toEqual({})
  })

  test('output nobody can read is an error, not an empty config', () => {
    // Read as "nothing is served", unparseable output would re-serve every
    // time and report a change that never happened.
    expect(() => parseServeStatus('not json')).toThrow()
  })
})

describe('deciding what to do about one route', () => {
  test('serves a port nothing is on', () => {
    expect(decide({}, PLAYGROUND, HOST)).toBe('serve')
  })

  test('does nothing when the route is already exactly this one', () => {
    expect(decide(served(PLAYGROUND.port, PLAYGROUND.target), PLAYGROUND, HOST)).toBe('already')
  })

  test('serves again when the port points somewhere else', () => {
    expect(decide(served(PLAYGROUND.port, 'http://127.0.0.1:9999'), PLAYGROUND, HOST)).toBe('serve')
  })

  test('leaves every other route alone', () => {
    // Scope is the load-bearing choice. The serve config is a per-node
    // aggregate that unrelated services write into, so this owns one port and
    // reports nothing about the rest — an authoritative version would have to
    // delete whatever it does not declare.
    const others = served(8801, 'http://127.0.0.1:8801')

    expect(decide(others, PLAYGROUND, HOST)).toBe('serve')
    expect(others.Web?.[`${HOST}:8801`]).toBeDefined()
  })

  test('refuses a port Funnel has already made public', () => {
    // Serve is tailnet-only; Funnel publishes the same handler to the whole
    // internet, and the two are one flag apart in the same subcommand. The
    // tailnet is this route's entire authentication boundary (ADR-0004), so
    // quietly re-serving over a Funnel would be the one mistake that turns a
    // stated boundary into no boundary at all.
    const public_ = {
      ...served(PLAYGROUND.port, PLAYGROUND.target),
      AllowFunnel: { [`${HOST}:${PLAYGROUND.port}`]: true },
    }

    expect(decide(public_, PLAYGROUND, HOST)).toBe('funnel')
  })

  test('refuses a Funnel even when nothing is served behind it', () => {
    expect(decide({ AllowFunnel: { [`${HOST}:${PLAYGROUND.port}`]: true } }, PLAYGROUND, HOST)).toBe(
      'funnel',
    )
  })
})

describe('what is declared', () => {
  test('one route, to the port `bun run dev` listens on', () => {
    // Named here so the declared surface is a thing the suite states rather
    // than a thing tailscaled remembers. A route nobody declares is invisible
    // to this, which is the honest limit of owning one port.
    expect(PLAYGROUND).toEqual({ port: 8805, target: 'http://127.0.0.1:5173', path: '/' })
  })
})
