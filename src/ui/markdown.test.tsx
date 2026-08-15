import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, test } from 'bun:test'

import { Markdown } from './markdown.tsx'

/**
 * What the agent actually writes. Claude Code answers in Markdown constantly —
 * headings, fenced code, lists — and it was all being drawn as one run of
 * literal text, asterisks and backticks included.
 *
 * Asserted against the rendered DOM rather than against React elements: what
 * matters is the tag a screen reader and a stylesheet see, not the shape of the
 * tree that produced it.
 */
function draw(text: string): HTMLElement {
  const view = render(<Markdown text={text} />)
  drawn.push(view)
  return view.container
}

const drawn: { unmount(): void }[] = []
afterEach(() => {
  for (const view of drawn) view.unmount()
  drawn.length = 0
})

describe('the shapes an answer comes in', () => {
  test('draws paragraphs as paragraphs, and a blank line as a break between them', () => {
    const out = draw('First thing.\n\nSecond thing.')

    expect([...out.querySelectorAll('p')].map((one) => one.textContent)).toEqual([
      'First thing.',
      'Second thing.',
    ])
  })

  test('joins the lines of one paragraph rather than breaking on every newline', () => {
    // A wrapped sentence is one sentence. Broken per line it reads as a poem.
    expect(draw('a sentence that\nwrapped').querySelector('p')?.textContent).toBe(
      'a sentence that wrapped',
    )
  })

  test('draws headings at the level they were written', () => {
    const out = draw('# One\n\n## Two\n\n###### Six')

    expect([...out.querySelectorAll('h1, h2, h6')].map((one) => one.tagName)).toEqual([
      'H1',
      'H2',
      'H6',
    ])
    expect(out.querySelector('h2')?.textContent).toBe('Two')
  })

  test('draws bold and italic as emphasis rather than as punctuation', () => {
    const out = draw('a **strong** and an *emphasised* word')

    expect(out.querySelector('strong')?.textContent).toBe('strong')
    expect(out.querySelector('em')?.textContent).toBe('emphasised')
    expect(out.textContent).toBe('a strong and an emphasised word')
  })

  test('draws inline code as code, keeping what is inside it verbatim', () => {
    const out = draw('run `bun test **src**` first')

    expect(out.querySelector('code')?.textContent).toBe('bun test **src**')
    // The markers inside a code span are not markers.
    expect(out.querySelector('strong')).toBeNull()
  })

  test('draws a fenced block as code, and remembers what language it claimed', () => {
    const out = draw('before\n\n```ts\nconst a = 1\nconst b = 2\n```\n\nafter')

    const code = out.querySelector('pre code')
    expect(code?.textContent).toBe('const a = 1\nconst b = 2')
    expect(code?.getAttribute('data-language')).toBe('ts')
    expect([...out.querySelectorAll('p')].map((one) => one.textContent)).toEqual([
      'before',
      'after',
    ])
  })

  test('keeps a fenced block verbatim, markers and all', () => {
    // A block of Markdown inside a block of code is the thing an agent writes
    // when it is telling you what to type.
    const out = draw('```md\n# not a heading\n**not bold**\n```')

    expect(out.querySelector('pre code')?.textContent).toBe('# not a heading\n**not bold**')
    expect(out.querySelector('h1')).toBeNull()
    expect(out.querySelector('strong')).toBeNull()
  })

  test('draws bullet and numbered lists as lists', () => {
    const bullets = draw('- one\n- two')
    expect(bullets.querySelector('ul')).not.toBeNull()
    expect([...bullets.querySelectorAll('li')].map((one) => one.textContent)).toEqual([
      'one',
      'two',
    ])

    const numbered = draw('1. first\n2. second')
    expect(numbered.querySelector('ol')).not.toBeNull()
    expect([...numbered.querySelectorAll('li')].map((one) => one.textContent)).toEqual([
      'first',
      'second',
    ])
  })

  test('nests a list under the item it was indented beneath', () => {
    const out = draw('- one\n  - inner\n- two')

    expect(out.querySelectorAll('ul').length).toBe(2)
    expect(out.querySelector('li ul li')?.textContent).toBe('inner')
  })

  test('draws a quote as a quote and a rule as a rule', () => {
    expect(draw('> said someone').querySelector('blockquote')?.textContent).toBe('said someone')
    expect(draw('above\n\n---\n\nbelow').querySelector('hr')).not.toBeNull()
  })
})

describe('links, which are the one thing that can bite', () => {
  test('draws a link to somewhere a browser may go', () => {
    const link = draw('see [the docs](https://example.com/x)').querySelector('a')

    expect(link?.getAttribute('href')).toBe('https://example.com/x')
    expect(link?.textContent).toBe('the docs')
    // A link out of a transcript is not this page's navigation.
    expect(link?.getAttribute('rel')).toContain('noopener')
  })

  test('refuses a scheme that runs rather than navigates', () => {
    // The one hole a renderer with no innerHTML still has: React escapes text,
    // and an `href` is not text. A transcript is full of words a model was
    // told to repeat, so this is reachable by asking the agent to say it.
    for (const bad of [
      '[click](javascript:alert(1))',
      '[click](JaVaScRiPt:alert(1))',
      '[click](data:text/html,<script>alert(1)</script>)',
      '[click](vbscript:msgbox)',
    ]) {
      const out = draw(bad)

      expect(out.querySelector('a')).toBeNull()
      // Still says what it said — dropped from the markup, not from the words.
      expect(out.textContent).toContain('click')
    }
  })
})

describe('what a half-written answer looks like', () => {
  test('renders an unclosed fence as the code it is going to be', () => {
    // `draw` runs per token, so a fence is open for as long as the block takes
    // to arrive. Rendered as a paragraph until it closes, every line of a code
    // block would reflow into prose and then snap back to code — which reads
    // as the screen glitching rather than as an answer arriving.
    const out = draw('here you go\n\n```ts\nconst a = 1')

    expect(out.querySelector('pre code')?.textContent).toBe('const a = 1')
  })

  test('leaves an unclosed emphasis marker as the character it is', () => {
    // Auto-closing would make the rest of the answer bold until the second
    // asterisk lands, and the whole paragraph would change weight mid-stream.
    expect(draw('a **half written').textContent).toBe('a **half written')
    expect(draw('a **half written').querySelector('strong')).toBeNull()
  })

  test('leaves an unclosed link as the characters it is', () => {
    expect(draw('see [the docs](https://exa').textContent).toBe('see [the docs](https://exa')
  })
})

describe('what it never does', () => {
  test('draws markup in the words as words', () => {
    const out = draw('the tag is <script>alert(1)</script> in prose')

    expect(out.querySelector('script')).toBeNull()
    expect(out.textContent).toContain('<script>alert(1)</script>')
  })

  test('draws an empty answer as nothing at all', () => {
    expect(draw('').textContent).toBe('')
    expect(draw('   \n  \n').textContent).toBe('')
  })
})
