/**
 * Vendored from Brainless — https://github.com/theswerd/brainless (MIT)
 * Upstream file: registry/brainless/claude/claude-header.tsx
 * Upstream commit: 4c5d5ab65ff6cfa8dbb6f27cb8c88d9092a48deb (2026-07-14)
 *
 * Local changes:
 *   - `cn` comes from ./lib/cn instead of `@/lib/utils`
 *   - Tailwind utilities carry the `cc:` prefix (see ./tailwind.css)
 *   - Hardcoded tokyo-night hex lifted into `--cc-*` custom properties; the
 *     divider's `${ROSE}55` becomes a `color-mix` on the same property
 *   - Sprite width read defensively, for `noUncheckedIndexedAccess`
 */
import type * as React from "react";
import { cn } from "./lib/cn.ts";

/**
 * ClaudeHeader — Claude Code's welcome box.
 *
 * The title-in-the-border is a real <fieldset>/<legend>, so it stays semantic
 * and inherits whatever background it sits on. The logo is Claude Code's own
 * pixel sprite, but drawn as a crisp SVG grid instead of quadrant-block glyphs
 * — no font seams, scales cleanly.
 */
const ACCENT = "var(--cc-accent)";
const MUTED = "var(--cc-muted)";

// Claude's launch sprite as a 1-bit bitmap (decoded from the terminal glyphs).
const LOGO_BITS = [
  "000111111111111000",
  "000110111111011000",
  "011111111111111110",
  "000111111111111000",
  "000010100001010000",
];

export function ClaudeLogo({
  scale = 4,
  color = ACCENT,
  className,
}: {
  scale?: number;
  color?: string;
  className?: string;
}) {
  const w = LOGO_BITS[0]?.length ?? 0;
  const h = LOGO_BITS.length;
  // Terminal char cells are taller than wide, so each sprite pixel is stretched
  // vertically (PH) to keep the logo's proportions instead of looking squat.
  const PH = 2.4;
  const rects: React.ReactElement[] = [];
  LOGO_BITS.forEach((row, y) => {
    let x = 0;
    while (x < w) {
      if (row[x] === "1") {
        let end = x;
        while (end < w && row[end] === "1") end += 1;
        rects.push(
          <rect key={`${x}-${y}`} x={x} y={y * PH} width={end - x} height={PH} />,
        );
        x = end;
      } else {
        x += 1;
      }
    }
  });
  return (
    <svg
      aria-hidden
      width={w * scale}
      height={h * PH * scale}
      viewBox={`0 0 ${w} ${h * PH}`}
      shapeRendering="crispEdges"
      fill={color}
      className={className}
    >
      {rects}
    </svg>
  );
}

export function ClaudeHeader({
  version = "v2.1.206",
  user = "Ben",
  model = "Fable 5 with xhigh effort · Claude Max",
  org = "ben@freestyle.sh's Organization",
  cwd = "~/dev/brainless",
  tips = ["Ask Claude to create a new app or clone a repo"],
  whatsNew = [
    "Added directory path suggestions to /cd",
    "Added a /doctor check that proposes trims",
  ],
  className,
}: {
  version?: string;
  user?: string;
  model?: string;
  org?: string;
  cwd?: string;
  tips?: string[];
  whatsNew?: string[];
  className?: string;
}) {
  return (
    <fieldset
      className={cn(
        "cc:min-w-0 cc:rounded-[6px] cc:border cc:px-3 cc:pb-3.5 cc:pt-1 cc:font-mono cc:text-[13px] cc:leading-[1.5] cc:text-[var(--cc-fg)] cc:sm:px-4",
        className,
      )}
      style={{ borderColor: ACCENT }}
    >
      <legend className="cc:max-w-full cc:truncate cc:px-2" style={{ color: ACCENT }}>
        Claude Code <span style={{ color: MUTED }}>{version}</span>
      </legend>

      <div className="cc:grid cc:min-w-0 cc:gap-4 cc:sm:grid-cols-[minmax(0,1fr)_1px_minmax(0,1.1fr)]">
        {/* left: identity */}
        <div className="cc:flex cc:min-w-0 cc:flex-col cc:items-center cc:gap-2 cc:py-1 cc:text-center">
          <div className="cc:font-semibold">Welcome back {user}!</div>
          <ClaudeLogo className="cc:my-1.5" />
          <div className="cc:min-w-0 cc:space-y-0.5 cc:break-words" style={{ color: MUTED }}>
            <div>{model}</div>
            <div>{org}</div>
            <div>{cwd}</div>
          </div>
        </div>

        <div
          aria-hidden
          className="cc:hidden cc:sm:block"
          style={{
            background: "color-mix(in srgb, var(--cc-accent) 33%, transparent)",
          }}
        />

        {/* right: tips + what's new */}
        <div className="cc:min-w-0 cc:space-y-1">
          <div className="cc:font-semibold" style={{ color: ACCENT }}>
            Tips for getting started
          </div>
          {tips.map((t) => (
            <div key={t} className="cc:truncate">
              {t}
            </div>
          ))}
          <div className="cc:my-1.5 cc:h-px" style={{ background: ACCENT }} />
          <div className="cc:font-semibold" style={{ color: ACCENT }}>
            What&apos;s new
          </div>
          {whatsNew.map((t) => (
            <div key={t} className="cc:truncate">
              {t}
            </div>
          ))}
          <div className="cc:truncate cc:italic" style={{ color: MUTED }}>
            /release-notes for more
          </div>
        </div>
      </div>
    </fieldset>
  );
}
