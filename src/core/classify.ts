import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'

import type {
  Frame,
  HarnessFrame,
  ImageFrame,
  PromptFrame,
  ReasoningFrame,
  ToolResultFrame,
  SlashCommandInfo,
  TextFrame,
  ThreadOpened,
  ToolCallFrame,
} from './frame.ts'

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
    case 'assistant':
      return agent(m)
    case 'user':
      return person(m)
    default:
      return []
  }
}

function agent(m: Rec): Frame[] {
  const thread = str(m['parent_tool_use_id'])

  return contentOf(m['message']).flatMap((block): Frame[] => {
    switch (str(block['type'])) {
      case 'text': {
        const text = str(block['text'])
        return text === undefined ? [] : [compact<TextFrame>({ kind: 'text', text, thread })]
      }
      case 'thinking': {
        const text = str(block['thinking'])
        return text === undefined
          ? []
          : [compact<ReasoningFrame>({ kind: 'reasoning', text, thread })]
      }
      case 'tool_use': {
        const id = str(block['id'])
        const name = str(block['name'])
        if (id === undefined || name === undefined) return []
        const input = record(block['input']) ?? {}
        return [
          compact<ToolCallFrame>({
            kind: 'tool-call',
            id,
            name,
            input,
            thread,
            opens: opensThread(name) ? threadOpenedBy(id, input) : undefined,
          }),
        ]
      }
      default:
        return []
    }
  })
}

function person(m: Rec): Frame[] {
  const thread = str(m['parent_tool_use_id'])
  const synthetic = m['isSynthetic'] === true ? true : undefined
  const content = record(m['message'])?.['content']

  if (typeof content === 'string') {
    return [compact<PromptFrame>({ kind: 'prompt', text: content, thread, synthetic })]
  }

  const blocks = contentOf(m['message'])
  const answers = blocks.filter((block) => str(block['type']) === 'tool_result')
  // The structured output belongs to a call, and the message names only one.
  const structured = answers.length === 1 ? m['tool_use_result'] : undefined

  return blocks.flatMap((block): Frame[] => {
    switch (str(block['type'])) {
      case 'text': {
        const text = str(block['text'])
        return text === undefined
          ? []
          : [compact<PromptFrame>({ kind: 'prompt', text, thread, synthetic })]
      }
      case 'image': {
        const image = imageIn(block, thread, undefined)
        return image ? [image] : []
      }
      case 'tool_result': {
        const id = str(block['tool_use_id'])
        if (id === undefined) return []
        return [
          compact<ToolResultFrame>({
            kind: 'tool-result',
            id,
            output: textIn(block['content']),
            isError: block['is_error'] === true,
            structured,
            thread,
          }),
          // A tool may hand back a screenshot for the Transcript to show.
          ...contentOf({ content: block['content'] }).flatMap((inner): Frame[] => {
            if (str(inner['type']) !== 'image') return []
            const image = imageIn(inner, thread, id)
            return image ? [image] : []
          }),
        ]
      }
      default:
        return []
    }
  })
}

function imageIn(block: Rec, thread: string | undefined, toolCallId: string | undefined) {
  const source = record(block['source'])
  if (!source) return undefined
  return compact<ImageFrame>({
    kind: 'image',
    mediaType: str(source['media_type']),
    data: str(source['data']),
    url: str(source['url']),
    toolCallId,
    thread,
  })
}

/** Tool output arrives as a string, or as blocks of which only text reads. */
function textIn(content: unknown): string {
  if (typeof content === 'string') return content
  return contentOf({ content })
    .flatMap((block) => {
      const text = str(block['text'])
      return str(block['type']) === 'text' && text !== undefined ? [text] : []
    })
    .join('\n')
}

/** A Thread is the line of work opened by a `Task` call. */
function opensThread(toolName: string): boolean {
  return toolName === 'Task'
}

function threadOpenedBy(id: string, input: Rec): ThreadOpened {
  return compact<ThreadOpened>({
    thread: id,
    description: str(input['description']),
    subagentType: str(input['subagent_type']),
  })
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

/** The content blocks of an SDK message, whatever else the wrapper carries. */
function contentOf(message: unknown): Rec[] {
  const envelope = record(message)
  if (!envelope) return []
  return list(envelope['content']).flatMap((block) => {
    const entry = record(block)
    return entry ? [entry] : []
  })
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
