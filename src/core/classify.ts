import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'

import type { Frame, HarnessFrame, SlashCommandInfo } from './frame.ts'

/**
 * What `classify` accepts. `SDKMessage` is imported as a **type only** and
 * every field is treated as optional on the way in: a panel must never fail a
 * Turn because the SDK grew a field, or dropped one.
 */
export type ClassifyInput = SDKMessage | Record<string, unknown>

/**
 * `classify(SDKMessage) → Frame[]` — what happened, once per SDK message, with
 * no memory, no clock, no socket and no runtime SDK import.
 *
 * An unrecognised message type produces no Frames and never throws.
 */
export function classify(message: ClassifyInput): Frame[] {
  const m = record(message)
  if (!m) return []

  switch (str(m['type'])) {
    case 'system':
      return system(m)
    default:
      return []
  }
}

function system(m: Rec): Frame[] {
  switch (str(m['subtype'])) {
    case 'init':
      return init(m)
    case 'commands_changed':
      return [{ kind: 'commands', commands: commandsOf(m['commands']) }]
    default:
      return []
  }
}

function init(m: Rec): Frame[] {
  const frames: Frame[] = []

  const sessionId = str(m['session_id'])
  if (sessionId !== undefined) frames.push({ kind: 'session', sessionId })

  frames.push(
    compact<HarnessFrame>({
      kind: 'harness',
      model: str(m['model']),
      cwd: str(m['cwd']),
      permissionMode: str(m['permissionMode']),
      apiKeySource: str(m['apiKeySource']),
      outputStyle: str(m['output_style']),
      version: str(m['claude_code_version']),
      tools: strings(m['tools']),
      agents: strings(m['agents']),
      skills: strings(m['skills']),
      mcpServers: named(m['mcp_servers'], (entry, name) =>
        compact({ name, status: str(entry['status']) }),
      ),
      plugins: named(m['plugins'], (entry, name) =>
        compact({ name, path: str(entry['path']), version: str(entry['version']) }),
      ),
    }),
  )

  const commands = commandsOf(m['slash_commands'])
  if (commands.length > 0) frames.push({ kind: 'commands', commands })

  return frames
}

/** `init` advertises bare names; `commands_changed` pushes whole records. */
function commandsOf(value: unknown): SlashCommandInfo[] {
  return list(value).flatMap((entry): SlashCommandInfo[] => {
    if (typeof entry === 'string') return [{ name: entry }]
    const command = record(entry)
    const name = command && str(command['name'])
    if (!command || name === undefined) return []
    return [
      compact<SlashCommandInfo>({
        name,
        description: str(command['description']),
        argumentHint: str(command['argumentHint']),
        aliases: strings(command['aliases']),
      }),
    ]
  })
}

// --- reading a shape we do not control ---------------------------------------

type Rec = Record<string, unknown>

/** Every property optional, so a Frame can be built before it is complete. */
type Loose<T> = { [K in keyof T]: T[K] | undefined }

/** Drops keys whose value is missing, which `exactOptionalPropertyTypes` wants. */
function compact<T extends object>(value: Loose<T>): T {
  const out: Rec = {}
  for (const [key, entry] of Object.entries(value)) {
    if (entry !== undefined) out[key] = entry
  }
  return out as T
}

function record(value: unknown): Rec | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Rec)
    : undefined
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function strings(value: unknown): string[] | undefined {
  return Array.isArray(value) ? value.filter((entry) => typeof entry === 'string') : undefined
}

/** Maps entries that carry a `name`, dropping those that do not. */
function named<T>(value: unknown, map: (entry: Rec, name: string) => T): T[] | undefined {
  if (!Array.isArray(value)) return undefined
  return value.flatMap((entry) => {
    const record_ = record(entry)
    const name = record_ && str(record_['name'])
    return record_ && name !== undefined ? [map(record_, name)] : []
  })
}
