import { describe, expect, test } from 'bun:test'

import { classify } from './classify.ts'

describe('init', () => {
  test('emits the Session id at init, not deferred to the result', () => {
    const frames = classify({
      type: 'system',
      subtype: 'init',
      session_id: 'sess-1',
      uuid: 'u-1',
    })

    expect(frames).toContainEqual({ kind: 'session', sessionId: 'sess-1' })
  })

  test('emits what the harness actually loaded', () => {
    const frames = classify({
      type: 'system',
      subtype: 'init',
      session_id: 'sess-1',
      uuid: 'u-1',
      model: 'claude-opus-4',
      cwd: '/repo',
      permissionMode: 'bypassPermissions',
      apiKeySource: 'none',
      output_style: 'default',
      claude_code_version: '2.1.0',
      tools: ['Read', 'Bash'],
      agents: ['reviewer'],
      skills: ['tdd'],
      mcp_servers: [{ name: 'linear', status: 'connected' }],
      plugins: [{ name: 'claude-mem', path: '/p', version: '1.0.0' }],
    })

    expect(frames).toContainEqual({
      kind: 'harness',
      model: 'claude-opus-4',
      cwd: '/repo',
      permissionMode: 'bypassPermissions',
      apiKeySource: 'none',
      outputStyle: 'default',
      version: '2.1.0',
      tools: ['Read', 'Bash'],
      agents: ['reviewer'],
      skills: ['tdd'],
      mcpServers: [{ name: 'linear', status: 'connected' }],
      plugins: [{ name: 'claude-mem', path: '/p', version: '1.0.0' }],
    })
  })

  test('emits the slash commands advertised at init', () => {
    const frames = classify({
      type: 'system',
      subtype: 'init',
      session_id: 'sess-1',
      slash_commands: ['commit', 'review'],
    })

    expect(frames).toContainEqual({
      kind: 'commands',
      commands: [{ name: 'commit' }, { name: 'review' }],
    })
  })

  test('emits the pushed list when commands change mid-Session', () => {
    const frames = classify({
      type: 'system',
      subtype: 'commands_changed',
      session_id: 'sess-1',
      commands: [
        {
          name: 'ship',
          description: 'Ship the backlog',
          argumentHint: '<ticket>',
          aliases: ['deliver'],
        },
      ],
    })

    expect(frames).toEqual([
      {
        kind: 'commands',
        commands: [
          {
            name: 'ship',
            description: 'Ship the backlog',
            argumentHint: '<ticket>',
            aliases: ['deliver'],
          },
        ],
      },
    ])
  })
})
