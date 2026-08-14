import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { Playground, type PlaygroundMode } from '../src/playground/app.tsx'

/**
 * The playground's entry point. Everything it renders lives in
 * `src/playground/`, so the whole app is exercised by `bun test src` rather
 * than only by a person opening a browser.
 *
 * The mode is read off the URL — `?mode=live` for a real agent, replay
 * otherwise — so switching is a plain link and a reload, which is also the
 * cheapest demonstration that a reload replays the log.
 */
const mode: PlaygroundMode =
  new URLSearchParams(window.location.search).get('mode') === 'live' ? 'live' : 'replay'

const root = document.getElementById('root')
if (!root) throw new Error('the playground page has no #root to mount into')

createRoot(root).render(
  // StrictMode on purpose: it mounts every effect twice, which is exactly the
  // redelivery the hook claims to be idempotent under.
  <StrictMode>
    <Playground mode={mode} />
  </StrictMode>,
)
