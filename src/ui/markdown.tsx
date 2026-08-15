'use client'

import * as React from 'react'

/**
 * The agent's answer, drawn as the Markdown it is written in.
 *
 * Claude Code answers in Markdown constantly — headings, fenced code, lists,
 * bold — and all of it arrived as one run of literal text with the asterisks
 * and backticks still in it.
 *
 * ## Why this is written here rather than installed
 *
 * The package has no runtime dependencies and asks a consumer for no setup, and
 * a Markdown library is a poor first exception: the ones worth having parse to
 * HTML, which means `dangerouslySetInnerHTML` and a sanitiser after it, on a
 * string a model wrote. Producing React elements instead means the text is
 * escaped by React on the way in and there is no HTML to sanitise — the whole
 * class of injection is absent rather than defended against.
 *
 * The exception is a URL: an `href` is an attribute, not text, so React escapes
 * nothing about it. That one is guarded by {@link safeHref}.
 *
 * ## What it does not do
 *
 * Tables, images, footnotes, reference links, and HTML blocks. They are rare in
 * a terminal answer and each is a real parser; anything unrecognised is drawn
 * as the characters it is, which is honest — a table renders as its pipes
 * rather than as a lie about what was said.
 *
 * ## Half-written answers
 *
 * This runs per token: the renderer sees every prefix of the answer as it
 * arrives, so half-open markers are the normal case rather than an edge one.
 * Two rules, both about not flickering:
 *
 * - **An unclosed fence is code.** Treated as prose until it closes, every line
 *   of a code block would reflow as text and then snap back — which reads as
 *   the screen glitching rather than as an answer arriving.
 * - **An unclosed inline marker is a character.** Auto-closing `**` would make
 *   the rest of the answer bold until the second one landed, changing the
 *   weight of a whole paragraph mid-sentence.
 */

/** One answer, parsed once per distinct text rather than once per render. */
export const Markdown = React.memo(function Markdown({ text }: { text: string }) {
  return <>{markdown(text)}</>
})

/** The blocks of an answer, as elements. */
export function markdown(text: string): React.ReactNode[] {
  const lines = text.split('\n')
  const out: React.ReactNode[] = []
  let at = 0

  while (at < lines.length) {
    const line = lines[at] ?? ''

    if (line.trim() === '') {
      at += 1
      continue
    }

    const fence = /^ {0,3}```(.*)$/.exec(line)
    if (fence) {
      const language = (fence[1] ?? '').trim()
      const body: string[] = []
      at += 1
      // Runs to the closing fence, or to the end of what has arrived — which
      // is the same thing while the block is still being written.
      while (at < lines.length && !/^ {0,3}```/.test(lines[at] ?? '')) {
        body.push(lines[at] ?? '')
        at += 1
      }
      at += 1
      out.push(
        <pre
          key={out.length}
          className="cc:overflow-x-auto cc:rounded cc:p-2 cc:text-[12px]"
          style={{ background: 'var(--cc-user-bg)' }}
        >
          <code {...(language === '' ? {} : { 'data-language': language })}>
            {body.join('\n')}
          </code>
        </pre>,
      )
      continue
    }

    const heading = /^ {0,3}(#{1,6})\s+(.*)$/.exec(line)
    if (heading) {
      const level = (heading[1] ?? '#').length
      const Tag = `h${level}` as 'h1'
      out.push(
        <Tag key={out.length} className="cc:font-bold cc:text-[var(--cc-fg)]">
          {inline(heading[2] ?? '')}
        </Tag>,
      )
      at += 1
      continue
    }

    if (/^ {0,3}([-*_])(\s*\1){2,}\s*$/.test(line)) {
      out.push(<hr key={out.length} style={{ borderColor: 'var(--cc-rule)' }} />)
      at += 1
      continue
    }

    if (/^ {0,3}>/.test(line)) {
      const body: string[] = []
      while (at < lines.length && /^ {0,3}>/.test(lines[at] ?? '')) {
        body.push((lines[at] ?? '').replace(/^ {0,3}>\s?/, ''))
        at += 1
      }
      out.push(
        <blockquote
          key={out.length}
          className="cc:border-l cc:pl-3 cc:text-[var(--cc-fg-dim)]"
          style={{ borderColor: 'var(--cc-rule)' }}
        >
          {markdown(body.join('\n'))}
        </blockquote>,
      )
      continue
    }

    if (bulletOf(line) !== undefined) {
      const [list, next] = listAt(lines, at)
      out.push(React.cloneElement(list, { key: out.length }))
      at = next
      continue
    }

    // Anything else is a paragraph, and runs until a blank line or a line that
    // starts a block of its own.
    const body: string[] = []
    while (at < lines.length) {
      const next = lines[at] ?? ''
      if (next.trim() === '' || starts(next)) break
      body.push(next.trim())
      at += 1
    }
    out.push(
      <p key={out.length} className="cc:whitespace-pre-wrap cc:break-words">
        {inline(body.join(' '))}
      </p>,
    )
  }

  return out
}

/** Whether a line opens a block, which is what ends the paragraph above it. */
function starts(line: string): boolean {
  return (
    /^ {0,3}```/.test(line) ||
    /^ {0,3}#{1,6}\s/.test(line) ||
    /^ {0,3}>/.test(line) ||
    /^ {0,3}([-*_])(\s*\1){2,}\s*$/.test(line) ||
    bulletOf(line) !== undefined
  )
}

/** How a line marks itself as a list item, and how deep it is indented. */
function bulletOf(line: string): { indent: number; ordered: boolean; text: string } | undefined {
  const item = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/.exec(line)
  if (!item) return undefined
  return {
    indent: (item[1] ?? '').length,
    ordered: /\d/.test(item[2] ?? ''),
    text: item[3] ?? '',
  }
}

/**
 * One list, and where it ended. Items indented further than the first open a
 * list of their own, hung off the item above them.
 */
function listAt(lines: string[], from: number): [React.ReactElement, number] {
  const first = bulletOf(lines[from] ?? '')
  const indent = first?.indent ?? 0
  const ordered = first?.ordered ?? false
  const items: React.ReactNode[] = []
  let at = from

  while (at < lines.length) {
    const item = bulletOf(lines[at] ?? '')
    if (!item || item.indent < indent) break
    if (item.indent > indent) {
      const [nested, next] = listAt(lines, at)
      const last = items.length - 1
      items[last] = (
        <li key={last} className="cc:min-w-0">
          {(items[last] as React.ReactElement<{ children: React.ReactNode }>).props.children}
          {React.cloneElement(nested, { key: 'nested' })}
        </li>
      )
      at = next
      continue
    }
    items.push(
      <li key={items.length} className="cc:min-w-0">
        {inline(item.text)}
      </li>,
    )
    at += 1
  }

  const Tag = ordered ? 'ol' : 'ul'
  return [
    <Tag className={ordered ? 'cc:list-decimal cc:pl-5' : 'cc:list-disc cc:pl-5'}>{items}</Tag>,
    at,
  ]
}

/**
 * The markers inside a line.
 *
 * Code spans are taken first, so the markers inside one are the characters they
 * are — an agent writing `` `**src**` `` means the asterisks.
 */
function inline(text: string): React.ReactNode[] {
  const out: React.ReactNode[] = []
  let rest = text
  let key = 0

  while (rest !== '') {
    const found = earliest(rest)
    if (!found) {
      out.push(rest)
      break
    }
    if (found.at > 0) out.push(rest.slice(0, found.at))
    out.push(React.cloneElement(found.node, { key: (key += 1) }))
    rest = rest.slice(found.at + found.length)
  }

  return out
}

/** The first marker in `text` that closes, and what it draws as. */
function earliest(
  text: string,
): { at: number; length: number; node: React.ReactElement } | undefined {
  const marks: { at: number; length: number; node: React.ReactElement }[] = []

  const code = /`([^`]+)`/.exec(text)
  if (code) {
    marks.push({
      at: code.index,
      length: code[0].length,
      node: (
        <code
          className="cc:rounded cc:px-1 cc:text-[12px]"
          style={{ background: 'var(--cc-user-bg)' }}
        >
          {code[1]}
        </code>
      ),
    })
  }

  const link = /\[([^\]]*)\]\(([^)\s]*)\)/.exec(text)
  if (link) {
    const href = safeHref(link[2] ?? '')
    marks.push({
      at: link.index,
      length: link[0].length,
      // A URL nobody should follow is drawn as what it said rather than as a
      // link that does nothing — the words are the agent's and are kept.
      node:
        href === undefined ? (
          <span>{link[0]}</span>
        ) : (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="cc:underline"
            style={{ color: 'var(--cc-accent)' }}
          >
            {link[1]}
          </a>
        ),
    })
  }

  const strong = /\*\*([^*]+)\*\*|__([^_]+)__/.exec(text)
  if (strong) {
    marks.push({
      at: strong.index,
      length: strong[0].length,
      node: <strong className="cc:font-bold">{strong[1] ?? strong[2]}</strong>,
    })
  }

  const em = /(?<![*\w])\*([^*\n]+)\*(?!\*)|(?<![_\w])_([^_\n]+)_(?!_)/.exec(text)
  if (em) {
    marks.push({
      at: em.index,
      length: em[0].length,
      node: <em className="cc:italic">{em[1] ?? em[2]}</em>,
    })
  }

  return marks.sort((a, b) => a.at - b.at || b.length - a.length)[0]
}

/**
 * A URL a browser may be sent to, or nothing.
 *
 * The one hole a renderer with no `innerHTML` still has: React escapes text,
 * and an `href` is not text — `javascript:` in one runs. A transcript is full
 * of words a model was told to repeat, so this is reachable by asking the agent
 * to say it rather than by compromising anything.
 *
 * An allow-list, not a block-list: a scheme nobody here has thought about is
 * refused rather than permitted.
 */
function safeHref(url: string): string | undefined {
  const trimmed = url.trim()
  if (trimmed === '') return undefined
  // Relative, or a fragment, or a query — no scheme, so nothing to run.
  if (/^[./#?]/.test(trimmed)) return trimmed
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(trimmed)
  if (!scheme) return trimmed
  const named = (scheme[1] ?? '').toLowerCase()
  return named === 'http' || named === 'https' || named === 'mailto' ? trimmed : undefined
}
