import { GlobalRegistrator } from "@happy-dom/global-registrator";

// Vendored components render to a DOM, so the suite needs one. happy-dom is
// registered globally before any test module is imported.
if (typeof document === "undefined") {
  GlobalRegistrator.register();
}

// React 19 only enables `act`-aware scheduling when this flag is set.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;
