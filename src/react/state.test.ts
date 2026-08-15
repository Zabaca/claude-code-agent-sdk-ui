import { expect, test } from 'bun:test'

import type { Frame } from '../core/frame.ts'
import type { PartialKind, PartialText } from '../core/partial.ts'
import { reduce } from '../core/reduce.ts'
import { type Arrival, initial, mark, type SessionState, step, transcriptOf } from './session.ts'

/**
 * The hook's own reducer, held to the invariant the example tests state one
 * case at a time: **what is on screen is the log, plus exactly the things not
 * yet in it, in the order they happened.**
 *
 * `step` is the second reducer in this package. It owns what *arrived* — the
 * retained Frames, the blocks still being written, the words still on the wire
 * — and core's `reduce` owns what that *means*. The seam between them is where
 * every ordering and settlement bug so far has lived, because the invariant
 * joining them was implicit: an optimistic Message must disappear at the exact
 * moment the Frame that is its whole takes its place, and never before, never
 * twice, and never from somewhere other than where it started.
 *
 * So it is asserted here over generated arrival sequences rather than over one
 * hand-written scenario. The generator is a model of the handler — it only
 * emits sequences a real handler could emit, because arbitrary Frames make the
 * invariant vacuous rather than strict.
 *
 * Every minted thing carries a token, `[[n]]`, stamped in the order it was
 * willed. That is what makes the counting and ordering properties sound: two
 * people's words that read the same are deliberately two Messages here, so an
 * assertion phrased on content alone could not tell a doubled Message from an
 * intended one.
 */

// --- a seeded stream of decisions -----------------------------------------------

/** mulberry32. A dependency would be a heavier price than nine lines. */
function rng(seed: number): () => number {
  let held = seed >>> 0
  return () => {
    held = (held + 0x6d2b79f5) >>> 0
    let t = held
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// --- a model of the handler ------------------------------------------------------

/**
 * One arrival, with what the generator knew when it made it. The notes are the
 * test's own bookkeeping — never re-derived from the reducer under test, which
 * would only assert that it agrees with itself.
 */
type Scripted = {
  arrival: Arrival
  /** This arrival is the Frame retaining the person's words willed at `settles`. */
  settles?: number
  /** A `sent` arrival's own mark, so its Frame can be found in the script. */
  mark?: number
  /** This Frame carries words already on screen, so the token is on screen twice. */
  mimics?: number
}

type Script = {
  seed: number
  steps: Scripted[]
  /** The handler's log, complete, as it stands after the last arrival. */
  log: Frame[]
}

type Block = { block: number; kind: PartialKind; thread?: string; text: string }

function generate(seed: number): Script {
  const random = rng(seed)
  const pick = <T,>(from: readonly T[]): T => from[Math.floor(random() * from.length)] as T
  const chance = (odds: number): boolean => random() < odds

  const steps: Scripted[] = []
  const log: Frame[] = []
  const open: Block[] = []
  const unechoed: { mark: number; text: string }[] = []
  let turnOpen = false
  let minted = 0
  let marks = 0
  let blocks = 0

  /**
   * A token stamped on each minted thing in the order it was willed. It is
   * identity first — two Messages that read the same are deliberately two
   * Messages here — and the clock the counting, tie-break and placement checks
   * are phrased against.
   */
  const token = (): string => {
    minted += 1
    return `[[${minted}]]`
  }

  const retain = (frame: Frame, settles?: number, mimics?: number): void => {
    const index = log.length
    log.push(frame)
    steps.push({
      arrival: { type: 'frame', index, body: JSON.stringify(frame) },
      ...(settles === undefined ? {} : { settles }),
      ...(mimics === undefined ? {} : { mimics }),
    })
  }

  const partial = (of: Block, done?: true): void => {
    const body: PartialText = {
      block: of.block,
      kind: of.kind,
      text: of.text,
      ...(done === undefined ? {} : { done }),
      ...(of.thread === undefined ? {} : { thread: of.thread }),
    }
    steps.push({ arrival: { type: 'partial', body: JSON.stringify(body) } })
  }

  /**
   * The `at` is a placeholder: the hook stamps one from `mark()` at the moment
   * the words are willed, and the same clock stamps a block when it opens. So
   * the driver stamps it too, when it applies the arrival — a script that
   * stamped its own at generation time would be ordering the person's words
   * against a clock the reducer never reads.
   */
  const send = (): void => {
    marks += 1
    const text = `${token()} words`
    steps.push({ arrival: { type: 'sent', at: 0, text }, mark: marks })
    unechoed.push({ mark: marks, text })
    turnOpen = true
  }

  /** The handler retains the words it was sent. This is what settles them. */
  const echo = (): void => {
    const one = unechoed.shift()
    if (!one) return
    retain({ kind: 'prompt', text: one.text }, one.mark)
  }

  /**
   * A prompt nobody at the keyboard wrote, and the case with teeth: it carries
   * **the person's own outstanding words**. The runtime re-emitting a prompt it
   * tagged, or a peer asking the same thing, is not the Frame retaining what was
   * typed — and matching on the words alone cannot tell the two apart, so the
   * tag is the only thing standing between a person's Message and being settled
   * by something that is not it. A generator minting fresh words here would
   * never put that rule under any load.
   */
  const unwilled = (): void => {
    const theirs = unechoed.length > 0 && chance(0.5)
    const text = theirs ? (pick(unechoed) as { text: string }).text : `${token()} words`
    const mimics = theirs ? Number.parseInt(/\[\[(\d+)]]/.exec(text)?.[1] ?? '-1', 10) : undefined
    if (chance(0.5)) retain({ kind: 'prompt', text, synthetic: true }, undefined, mimics)
    else retain({ kind: 'prompt', text, origin: { kind: 'peer', from: 'someone' } }, undefined, mimics)
  }

  const openBlock = (): void => {
    const thread = chance(0.6) ? pick(['t1', 't2']) : undefined
    blocks += 1
    const one: Block = {
      block: blocks,
      kind: chance(0.3) ? 'reasoning' : 'text',
      ...(thread === undefined ? {} : { thread }),
      text: `${token()} said`,
    }
    open.push(one)
    partial(one)
  }

  const growBlock = (): void => {
    const one = pick(open)
    if (!one) return
    one.text = `${one.text} more`
    partial(one)
  }

  /**
   * Blocks close in the order they opened, within a kind and a Thread — which
   * is what `retire` matching the oldest live block of that kind and Thread
   * relies on. Which group closes next is free; the order inside one is not.
   */
  const closeBlock = (choose: number): void => {
    const chosen = open[choose % Math.max(open.length, 1)]
    if (!chosen) return
    const at = open.findIndex((one) => one.kind === chosen.kind && one.thread === chosen.thread)
    const one = open[at]
    if (!one) return
    open.splice(at, 1)
    partial({ ...one }, true)
    retain({
      kind: one.kind,
      text: one.text,
      ...(one.thread === undefined ? {} : { thread: one.thread }),
    } as Frame)
  }

  const tool = (): void => {
    const id = `call-${log.length}`
    retain({ kind: 'tool-call', id, name: 'Bash', input: { command: 'ls' } })
    retain({ kind: 'tool-result', id, output: 'ok', isError: false })
  }

  const endTurn = (): void => {
    // Every block still being written goes with the Turn: the handler retains no
    // Frame for one the runtime never finished, so nothing outlives the log.
    open.length = 0
    retain({ kind: 'settled', result: 'done', turns: 1 })
    turnOpen = false
  }

  /** The whole log again, as a lost cursor or a doubled mount delivers it. */
  const replay = (): void => {
    for (const [index, frame] of log.entries()) {
      steps.push({ arrival: { type: 'frame', index, body: JSON.stringify(frame) } })
    }
  }

  const moves = 24 + Math.floor(random() * 24)
  for (let move = 0; move < moves; move++) {
    const roll = random()
    if (roll < 0.14) send()
    else if (roll < 0.28) echo()
    else if (roll < 0.34) unwilled()
    else if (roll < 0.58 && turnOpen) openBlock()
    else if (roll < 0.70) growBlock()
    else if (roll < 0.80) closeBlock(Math.floor(random() * Math.max(open.length, 1)))
    else if (roll < 0.88) tool()
    else if (roll < 0.94 && turnOpen) endTurn()
    else if (roll < 0.97) replay()
    else send()
  }

  // Drained, so the end state is one where nothing is outstanding and the
  // Transcript must be the log and only the log.
  while (unechoed.length > 0) echo()
  while (open.length > 0) closeBlock(0)
  endTurn()

  return { seed, steps, log }
}

// --- reading what is on screen ---------------------------------------------------

/** Every minted token in Transcript order, coalescing and all. */
function tokensOf(transcript: { messages: readonly unknown[] }): number[] {
  const found: number[] = []
  for (const message of transcript.messages) {
    for (const hit of JSON.stringify(message).matchAll(/\[\[(\d+)]]/g)) {
      found.push(Number.parseInt(hit[1] as string, 10))
    }
  }
  return found
}

function promptsOf(transcript: { messages: readonly { kind: string }[] }): number {
  return transcript.messages.filter((message) => message.kind === 'prompt').length
}

/** The token a live block carries, so liveness can be read off the state. */
function tokenIn(text: string): number {
  return Number.parseInt(/\[\[(\d+)]]/.exec(text)?.[1] ?? '-1', 10)
}

// --- the properties --------------------------------------------------------------

const SEEDS = 300

/**
 * Note what is *not* asserted: that the Transcript is in willing order
 * throughout. It is not, and must not be. An optimistic Message is placed
 * against the log as it stood when it was willed, and the log is the authority
 * on what came first — so a person's words shown before a peer's prompt had
 * arrived move behind it once the Frame for them lands at the later index. That
 * is the log correcting a guess, not a Message jumping.
 *
 * What must hold is narrower and is the thing that has broken: **a block keeps
 * the place it opened at.** Nothing that was ahead of it then ends up behind
 * it, a delta never moves it, it is never on screen twice over, and it does not
 * leave the screen before the Frame that is its whole arrives.
 */
test('what is on screen is the log, plus exactly what is not in it yet, placed where it started', () => {
  for (let seed = 1; seed <= SEEDS; seed++) {
    const script = generate(seed)
    for (const reasoning of [true, false]) {
      let state: SessionState = initial()
      /** Frame indices already delivered, so a replay is not counted twice. */
      const held = new Set<number>()
      /** Marks whose Frame has arrived: the words the log now speaks for. */
      const echoed = new Set<number>()
      /** What was on screen ahead of a block the moment it opened. */
      const ahead = new Map<number, number[]>()
      /** Tokens minted for prose, so the prompts' own tension is left out of it. */
      const prose = new Set<number>()
      /** Tokens on screen twice over, which no seat in the order can be read off. */
      const doubled = new Set<number>()
      /** Where each live block was placed, so a delta moving one is visible. */
      const placed = new Map<number, number>()
      /** Prose that is on screen and has no business leaving it. */
      const persist = new Set<number>()
      let sent = 0
      let prompts = 0

      for (const [at, scripted] of script.steps.entries()) {
        const arrival: Arrival =
          scripted.arrival.type === 'sent' ? { ...scripted.arrival, at: mark() } : scripted.arrival
        if (arrival.type === 'sent') sent += 1
        if (arrival.type === 'partial') prose.add(tokenIn(arrival.body))
        // A Frame already held is the same Frame again, and settles nothing a
        // second time — so the count it is held to does not move either.
        let ends = false
        if (arrival.type === 'frame' && !held.has(arrival.index)) {
          held.add(arrival.index)
          const frame = script.log[arrival.index] as Frame
          ends = frame.kind === 'settled' || frame.kind === 'failed'
          if (frame.kind === 'prompt') prompts += 1
          if (scripted.settles !== undefined) echoed.add(scripted.settles)
          if (scripted.mimics !== undefined) doubled.add(scripted.mimics)
        }

        state = step(state, arrival)
        const transcript = transcriptOf(state, reasoning)
        const tokens = tokensOf(transcript)
        const where = `seed ${script.seed}, reasoning ${reasoning}, arrival ${at}`

        // Nothing doubled, nothing eaten: a person's words are on screen once
        // from the moment they are willed until the Frame for them arrives, and
        // once from then on — and a prompt nobody typed settles none of theirs.
        expect(`${where}: prompts ${promptsOf(transcript)}`).toBe(
          `${where}: prompts ${prompts + (sent - echoed.size)}`,
        )

        // A Turn that ends takes every unfinished block with it, and the log
        // speaks for nothing the runtime never completed. That is the one way
        // prose leaves the screen; any other way is a block being retired by a
        // Frame that is not its own.
        if (ends) {
          for (const token of [...persist]) if (!tokens.includes(token)) persist.delete(token)
        } else {
          for (const token of persist) {
            expect(`${where}: ${token} still on screen ${tokens.includes(token)}`).toBe(
              `${where}: ${token} still on screen true`,
            )
          }
        }
        for (const token of tokens) if (prose.has(token)) persist.add(token)

        // A block is on screen once: the live copy or the Frame that is its
        // whole, never both. A Frame that fails to take its block's place reads
        // as the agent saying the same thing twice.
        for (const token of new Set(tokens)) {
          if (!prose.has(token)) continue
          expect(`${where}: ${token} on screen ${tokens.filter((one) => one === token).length} times`).toBe(
            `${where}: ${token} on screen 1 times`,
          )
        }

        const live = state.live.map((block) => tokenIn(block.text))
        for (const token of live) {
          const seat = tokens.indexOf(token)
          if (seat === -1) continue
          // The place it started at, noted once and never revised.
          if (!ahead.has(token)) {
            ahead.set(token, tokens.slice(0, seat).filter((one) => prose.has(one)))
            continue
          }
          for (const before of ahead.get(token) as number[]) {
            const was = tokens.indexOf(before)
            if (was === -1) continue
            expect(`${where}: ${before} ahead of ${token} at ${was} < ${seat}`).toBe(
              `${where}: ${before} ahead of ${token} at ${was} < ${was < seat ? seat : was + 1}`,
            )
          }
        }

        // Two unretained things that belong at the same place in the log are
        // ordered by which was willed first, and by nothing else. A person
        // typing while the agent writes and an agent answering something just
        // sent are the same situation from opposite ends, so the tie between
        // them is broken on the one clock both are stamped against.
        const waiting = [
          ...state.live.map((block) => ({ token: tokenIn(block.text), after: block.after })),
          ...state.sent.map((one) => ({ token: tokenIn(one.text), after: one.after })),
        ]
          .filter((one) => tokens.includes(one.token) && !doubled.has(one.token))
          .sort((a, b) => a.token - b.token)
        for (const [index, one] of waiting.entries()) {
          const next = waiting[index + 1]
          if (!next || next.after !== one.after) continue
          const seats = [tokens.indexOf(one.token), tokens.indexOf(next.token)]
          expect(`${where}: ${one.token} before ${next.token} at ${seats[0]}`).toBe(
            `${where}: ${one.token} before ${next.token} at ${
              (seats[0] as number) < (seats[1] as number) ? seats[0] : (seats[1] as number) - 1
            }`,
          )
        }

        // A block's place is stamped when it opens and moved only by a Frame
        // settling a block ahead of it. A delta is more of the same block, so a
        // block that grows while the log grows around it stays where it was —
        // restamping is what used to carry a Thread's prose down past the
        // Frames that landed while it was being written.
        for (const block of state.live) {
          const token = tokenIn(block.text)
          const was = placed.get(token)
          if (was !== undefined && arrival.type === 'partial') {
            expect(`${where}: ${token} placed after ${block.after}`).toBe(
              `${where}: ${token} placed after ${was}`,
            )
          }
          placed.set(token, block.after)
        }

        // Every quiet moment is a cold reload: with nothing outstanding, what
        // the hook hands out is what the log alone builds. This is where a
        // Message that settled into the wrong place, or never settled at all,
        // stops being invisible.
        if (state.live.length === 0 && state.sent.length === 0) {
          expect(transcript).toEqual(reduce(script.log.slice(0, held.size), { reasoning }))
        }
      }

      // Drained, the optimistic half must be contributing nothing at all.
      expect(transcriptOf(state, reasoning)).toEqual(reduce(script.log, { reasoning }))
    }
  }
})

