import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'

import type {
  CompactedFrame,
  ContextAgent,
  ContextCategory,
  ContextFrame,
  ContextMcpTool,
  ContextMemoryFile,
  ContextSkill,
  CostFrame,
  FailedFrame,
  Frame,
  HarnessFrame,
  HookFrame,
  ImageFrame,
  ModelCost,
  PromptFrame,
  PromptOrigin,
  RateLimitFrame,
  RecallFrame,
  RecalledMemory,
  ReasoningFrame,
  SettledFrame,
  SlashCommandInfo,
  TextFrame,
  ThreadOpened,
  TokenUsage,
  ToolCallFrame,
  ToolProgressFrame,
  ToolResultFrame,
} from './frame.ts'

/**
 * What `classify` accepts. `SDKMessage` is imported as a **type only** and
 * every field is treated as optional on the way in: a panel must never fail a
 * Turn because the SDK grew a field, or dropped one. Any `SDKMessage` is a
 * `ClassifyInput`; so is a recorded message from an SDK version this build has
 * never seen.
 */
export type ClassifyInput = { readonly [field: string]: unknown }

/**
 * `classify(SDKMessage) → Frame[]` — what happened, once per SDK message, with
 * no memory, no clock, no socket and no runtime SDK import.
 *
 * An unrecognised message type produces no Frames and never throws.
 *
 * Partial `stream_event` messages produce no Frames: partial text streams live
 * on the wire, and the server folds a block's partials into the whole message
 * this sees, so what is retained holds whole Messages and stays a deterministic
 * fixture rather than a timing-dependent recording.
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
    case 'result':
      return outcome(m)
    case 'tool_progress':
      return toolProgress(m)
    case 'conversation_reset': {
      const transcriptId = str(m['new_conversation_id'])
      return transcriptId === undefined ? [] : [{ kind: 'reset', transcriptId }]
    }
    case 'rate_limit_event':
      return rateLimit(m['rate_limit_info'])
    default:
      return []
  }
}

function agent(m: Rec): Frame[] {
  const thread = str(m['parent_tool_use_id'])

  // The Thread reaches the context reading as well as the prose: an assistant
  // message names one Thread, and everything hanging off it belongs to that
  // Thread. Handing it only to `spoken` is what made a sub-agent's window read
  // as the Session's (#17).
  return [...spoken(m, thread), ...contextUsage(m['context_usage'], thread)]
}

function spoken(m: Rec, thread: string | undefined): Frame[] {
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
  const origin = originIn(m['origin'])
  const content = record(m['message'])?.['content']

  if (typeof content === 'string') {
    return [compact<PromptFrame>({ kind: 'prompt', text: content, thread, synthetic, origin })]
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
          : [compact<PromptFrame>({ kind: 'prompt', text, thread, synthetic, origin })]
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

function outcome(m: Rec): Frame[] {
  const subtype = str(m['subtype'])
  const turns = num(m['num_turns'])
  const durationMs = num(m['duration_ms'])
  const terminalReason = str(m['terminal_reason'])

  const ended: Frame =
    subtype === 'success'
      ? compact<SettledFrame>({
          kind: 'settled',
          result: str(m['result']),
          turns,
          durationMs,
          stopReason: str(m['stop_reason']),
          terminalReason,
        })
      : compact<FailedFrame>({
          kind: 'failed',
          subtype: subtype ?? 'unknown',
          reason: reasonIn(m) ?? subtype ?? 'unknown',
          turns,
          durationMs,
          stopReason: str(m['stop_reason']),
          terminalReason,
        })

  const usd = num(m['total_cost_usd'])
  if (usd === undefined) return [ended]

  return [
    ended,
    compact<CostFrame>({
      kind: 'cost',
      usd,
      turns,
      durationMs,
      usage: tokensIn(m['usage']),
      byModel: byModel(m['modelUsage']),
    }),
  ]
}

/** A failure states its reason in the runtime's own words where it gave any. */
function reasonIn(m: Rec): string | undefined {
  const errors = strings(m['errors'])?.filter((error) => error.length > 0) ?? []
  if (errors.length > 0) return errors.join('\n')
  return str(m['result'])
}

function tokensIn(value: unknown): TokenUsage | undefined {
  const usage = record(value)
  if (!usage) return undefined
  const tokens = compact<TokenUsage>({
    inputTokens: num(usage['input_tokens']),
    outputTokens: num(usage['output_tokens']),
    cacheReadInputTokens: num(usage['cache_read_input_tokens']),
    cacheCreationInputTokens: num(usage['cache_creation_input_tokens']),
  })
  return Object.keys(tokens).length > 0 ? tokens : undefined
}

function byModel(value: unknown): Record<string, ModelCost> | undefined {
  const usage = record(value)
  if (!usage) return undefined
  const out: Record<string, ModelCost> = {}
  for (const [model, entry] of Object.entries(usage)) {
    const totals = record(entry)
    if (!totals) continue
    out[model] = compact<ModelCost>({
      costUsd: num(totals['costUSD']),
      inputTokens: num(totals['inputTokens']),
      outputTokens: num(totals['outputTokens']),
      cacheReadInputTokens: num(totals['cacheReadInputTokens']),
      cacheCreationInputTokens: num(totals['cacheCreationInputTokens']),
    })
  }
  return Object.keys(out).length > 0 ? out : undefined
}

/** Who asked, when a Turn started that the person at the keyboard did not. */
function originIn(value: unknown): PromptOrigin | undefined {
  const origin = record(value)
  const kind = origin && str(origin['kind'])
  if (!origin || kind === undefined) return undefined
  return compact<PromptOrigin>({
    kind,
    from: str(origin['from']),
    name: str(origin['name']),
    server: str(origin['server']),
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

/**
 * The runtime's live word on a call that has not answered yet.
 *
 * Emitted rather than dropped because it is the only place the wire says how
 * long something has been running. On a `Task` call that is how long a Thread
 * has been going — which nothing else reports, and which a renderer would
 * otherwise have to guess from when it happened to start watching.
 */
function toolProgress(m: Rec): Frame[] {
  const id = str(m['tool_use_id'])
  const name = str(m['tool_name'])
  const elapsedSeconds = num(m['elapsed_time_seconds'])
  if (id === undefined || name === undefined || elapsedSeconds === undefined) return []
  return [
    compact<ToolProgressFrame>({
      kind: 'tool-progress',
      id,
      name,
      elapsedSeconds,
      thread: str(m['parent_tool_use_id']),
      subagentType: str(m['subagent_type']),
      heartbeat: m['heartbeat'] === true ? true : undefined,
    }),
  ]
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
    case 'compact_boundary':
      return [compacted(m['compact_metadata'])]
    case 'hook_started':
      return hook(m, 'started')
    case 'hook_progress':
      return hook(m, 'running')
    case 'hook_response':
      return hook(m, str(m['outcome']) ?? 'success')
    case 'memory_recall':
      return [
        compact<RecallFrame>({
          kind: 'recall',
          mode: str(m['mode']),
          memories: memoriesIn(m['memories']),
        }),
      ]
    default:
      return []
  }
}

function hook(m: Rec, status: string): Frame[] {
  const name = str(m['hook_name'])
  if (name === undefined) return []
  return [
    compact<HookFrame>({
      kind: 'hook',
      id: str(m['hook_id']),
      name,
      hookEvent: str(m['hook_event']),
      status,
      output: str(m['output']),
      stdout: str(m['stdout']),
      stderr: str(m['stderr']),
      exitCode: num(m['exit_code']),
    }),
  ]
}

function compacted(metadata: unknown): Frame {
  const meta = record(metadata) ?? {}
  return compact<CompactedFrame>({
    kind: 'compacted',
    trigger: str(meta['trigger']),
    preTokens: num(meta['pre_tokens']),
    postTokens: num(meta['post_tokens']),
    durationMs: num(meta['duration_ms']),
  })
}

function memoriesIn(value: unknown): RecalledMemory[] {
  return list(value).flatMap((entry): RecalledMemory[] => {
    const memory = record(entry)
    const path = memory && str(memory['path'])
    if (!memory || path === undefined) return []
    return [
      compact<RecalledMemory>({
        path,
        scope: str(memory['scope']),
        content: str(memory['content']),
      }),
    ]
  })
}

function rateLimit(value: unknown): Frame[] {
  const info = record(value)
  if (!info) return []
  return [
    compact<RateLimitFrame>({
      kind: 'rate-limit',
      status: str(info['status']),
      limitType: str(info['rateLimitType']),
      utilization: num(info['utilization']),
      resetsAt: num(info['resetsAt']),
      overageStatus: str(info['overageStatus']),
      usingOverage: typeof info['isUsingOverage'] === 'boolean' ? info['isUsingOverage'] : undefined,
    }),
  ]
}

/** The structured twin of the /context report, when the SDK attaches one. */
function contextUsage(value: unknown, thread: string | undefined): Frame[] {
  const usage = record(value)
  const totalTokens = usage && num(usage['total_tokens'])
  if (!usage || totalTokens === undefined) return []

  const overLimit = record(usage['over_limit'])

  return [
    compact<ContextFrame>({
      kind: 'context',
      thread,
      model: str(usage['model']),
      totalTokens,
      maxTokens: num(usage['raw_max_tokens']),
      percentage: num(usage['percentage']),
      overLimit: overLimit
        ? compact<{ tokensOver?: number; kind?: string }>({
            tokensOver: num(overLimit['tokens_over']),
            kind: str(overLimit['kind']),
          })
        : undefined,
      categories: identified(usage['categories'], 'name', (entry, name) =>
        compact<ContextCategory>({ name, tokens: num(entry['tokens']), kind: str(entry['kind']) }),
      ),
      mcpTools: identified(usage['mcp_tools'], 'name', (entry, name) =>
        compact<ContextMcpTool>({
          name,
          serverName: str(entry['server_name']),
          tokens: num(entry['tokens']),
        }),
      ),
      memoryFiles: identified(usage['memory_files'], 'path', (entry, path) =>
        compact<ContextMemoryFile>({
          path,
          type: str(entry['type']),
          tokens: num(entry['tokens']),
        }),
      ),
      agents: identified(usage['agents'], 'agent_type', (entry, agentType) =>
        compact<ContextAgent>({
          agentType,
          source: str(entry['source']),
          tokens: num(entry['tokens']),
        }),
      ),
      skills: identified(usage['skills'], 'name', (entry, name) =>
        compact<ContextSkill>({
          name,
          source: str(entry['source']),
          pluginName: str(entry['plugin_name']),
          tokens: num(entry['tokens']),
        }),
      ),
    }),
  ]
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
      mcpServers: identified(m['mcp_servers'], 'name', (entry, name) =>
        compact({ name, status: str(entry['status']) }),
      ),
      plugins: identified(m['plugins'], 'name', (entry, name) =>
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

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function strings(value: unknown): string[] | undefined {
  return Array.isArray(value) ? value.filter((entry) => typeof entry === 'string') : undefined
}

/**
 * Maps the entries of a list that carry the field identifying them, dropping
 * those that do not.
 */
function identified<T>(
  value: unknown,
  field: string,
  map: (entry: Rec, id: string) => T,
): T[] | undefined {
  if (!Array.isArray(value)) return undefined
  return value.flatMap((item) => {
    const entry = record(item)
    const id = entry && str(entry[field])
    return entry && id !== undefined ? [map(entry, id)] : []
  })
}
