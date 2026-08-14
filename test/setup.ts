import { GlobalRegistrator } from "@happy-dom/global-registrator";

// Vendored components render to a DOM, so the suite needs one. happy-dom is
// registered globally before any test module is imported.
if (typeof document === "undefined") {
  GlobalRegistrator.register();
}

// React 19 only enables `act`-aware scheduling when this flag is set.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

// Testing Library's auto-cleanup keys off a global `afterEach`, which bun:test
// does not expose ambiently. Registering it here unmounts every tree between
// tests — without it, ClaudeThinking's intervals keep the runner alive.
const { cleanup } = await import("@testing-library/react");
const { afterEach } = await import("bun:test");
afterEach(cleanup);
