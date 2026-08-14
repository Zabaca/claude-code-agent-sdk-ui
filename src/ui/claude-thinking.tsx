"use client";

/**
 * Vendored from Brainless — https://github.com/theswerd/brainless (MIT)
 * Upstream file: registry/brainless/claude/claude-thinking.tsx
 * Upstream commit: 4c5d5ab65ff6cfa8dbb6f27cb8c88d9092a48deb (2026-07-14)
 *
 * Local changes:
 *   - Hardcoded tokyo-night hex lifted into `--cc-*` custom properties, in the
 *     inline <style> block as well as the element styles
 *   - `--font-geist-mono` becomes `--cc-font-mono`
 *   - the `cw-verb` shimmer class is namespaced to `cc-cw-verb`
 */
import * as React from "react";

/**
 * ClaudeThinking — Claude Code's "working" line.
 *
 * A pulsing sparkle glyph, a whimsical verb, and a live elapsed / interrupt
 * hint. The verb carries Claude's understated shimmer: a lighter highlight
 * drifts across the terracotta word like a gradient wave (done with
 * background-clip: text so the DOM text stays selectable and announced). The
 * whole line is a polite live region for screen readers.
 */
// Captured cycle from claude/thinking frames: · ✢ ✳ ✶ ✻ ✽ ✻ ✶ ✳ ✢
const GLYPHS = ["·", "✢", "✳", "✶", "✻", "✽", "✻", "✶", "✳", "✢"];
const VERBS = [
  "Thinking",
  "Levitating",
  "Schlepping",
  "Herding",
  "Percolating",
  "Noodling",
  "Conjuring",
];

export function ClaudeThinking({
  running = true,
  verbs = VERBS,
  showTokens = true,
  className,
}: {
  running?: boolean;
  verbs?: string[];
  showTokens?: boolean;
  className?: string;
}) {
  const prefersReduced = usePrefersReducedMotion();
  const [glyph, setGlyph] = React.useState(0);
  const [verbIdx, setVerbIdx] = React.useState(0);
  const [secs, setSecs] = React.useState(0);

  React.useEffect(() => {
    if (!running || prefersReduced) return;
    const id = setInterval(() => setGlyph((g) => (g + 1) % GLYPHS.length), 110);
    return () => clearInterval(id);
  }, [running, prefersReduced]);

  React.useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setSecs((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [running]);

  React.useEffect(() => {
    if (!running) return;
    // Verbs change slowly, like the real thing — not every second.
    const id = setInterval(() => setVerbIdx((v) => (v + 1) % verbs.length), 5200);
    return () => clearInterval(id);
  }, [running, verbs.length]);

  if (!running) return null;

  const verb = verbs[verbIdx % verbs.length];
  const tokens = showTokens ? ` · ↑ ${Math.max(0, secs * 137)} tokens` : "";

  return (
    <div
      role="status"
      aria-live="polite"
      className={className}
      style={{
        fontFamily: "var(--cc-font-mono, ui-monospace, monospace)",
        fontSize: 13,
        display: "flex",
        alignItems: "center",
        gap: 8,
      }}
    >
      <style>{`
        .cc-cw-verb {
          background-image: linear-gradient(100deg, var(--cc-accent) 43%, var(--cc-accent-bright) 50%, var(--cc-accent) 57%);
          background-size: 200% 100%;
          -webkit-background-clip: text;
          background-clip: text;
          color: transparent;
          -webkit-text-fill-color: transparent;
          animation: cc-cw-shine 2.8s linear infinite;
        }
        @keyframes cc-cw-shine {
          from { background-position: 100% 0; }
          to   { background-position: -100% 0; }
        }
        @media (prefers-reduced-motion: reduce) {
          .cc-cw-verb {
            animation: none;
            background-image: none;
            color: var(--cc-accent);
            -webkit-text-fill-color: var(--cc-accent);
          }
        }
      `}</style>
      <span
        aria-hidden
        style={{
          color: "var(--cc-accent)",
          width: "1ch",
          display: "inline-block",
        }}
      >
        {prefersReduced ? "✳" : GLYPHS[glyph]}
      </span>
      <span className="cc-cw-verb">{verb}…</span>
      <span style={{ color: "var(--cc-working-dim)" }}>
        ({secs}s{tokens} · esc to interrupt)
      </span>
    </div>
  );
}

function usePrefersReducedMotion() {
  const [reduced, setReduced] = React.useState(false);
  React.useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const on = () => setReduced(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return reduced;
}
