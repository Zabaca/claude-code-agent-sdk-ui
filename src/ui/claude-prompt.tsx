"use client";

/**
 * Vendored from Brainless — https://github.com/theswerd/brainless (MIT)
 * Upstream file: registry/brainless/claude/claude-prompt.tsx
 * Upstream commit: 4c5d5ab65ff6cfa8dbb6f27cb8c88d9092a48deb (2026-07-14)
 *
 * Local changes:
 *   - `cn` comes from ./lib/cn instead of `@/lib/utils`
 *   - Tailwind utilities carry the `cc:` prefix (see ./tailwind.css)
 *   - Hardcoded tokyo-night hex lifted into `--cc-*` custom properties
 *   - `onSubmit`, `onModeChange` and `onEffortChange`, so the composer reports
 *     what a person did instead of only drawing chrome. The component stays
 *     presentational: mode and effort remain props, and the callbacks report
 *     the next value rather than keeping any of it. Offered upstream.
 *   - upstream's bare `term-input` hook class is namespaced to `cc-term-input`;
 *     it is a styling hook for consumers, not a Tailwind utility
 *   - the effort chip, the mode line and the field itself neutralise the user
 *     agent's control chrome on themselves (`RESET` below). Upstream draws the
 *     chip and the mode line as spans and never meets the problem; here a
 *     callback turns them into real buttons, and the stylesheet ships no
 *     Preflight — deliberately, because a component library has no business
 *     resetting its host's page. Scoped to our own three controls so that
 *     decision survives. Offered upstream.
 *   - the field is a `textarea`, not an `input`, so shift+Enter opens a second
 *     line as the terminal's composer does. It is sized to its content rather
 *     than to `rows`, and Enter still sends.
 *   - `ClaudeMode` and `ClaudeEffort` are defined in `core/composer.ts` and
 *     re-exported here unchanged, so that `react` can name a mode without
 *     depending on `ui`. The contract is identical and re-syncing is unaffected
 */
import * as React from "react";
import type { ClaudeEffort, ClaudeMode } from "../core/composer.ts";
import { cn } from "./lib/cn.ts";

/**
 * ClaudePrompt — Claude Code's input composer.
 *
 * Dual CSS rules around a real field (❯ prefix) that grows with its content,
 * effort chip above, and a mode line below. Mode colors/glyphs match shift+tab captures:
 *   auto          ⏵⏵ gold
 *   manual        ⏸  gray
 *   accept-edits  ⏵⏵ lavender
 *   plan          ⏸  teal
 *
 * Effort chips match `/effort` captures (glyph fills as effort rises):
 *   low ○ · medium ◐ · high ● · xhigh ◉ · max ◈ · ultracode ✦
 * Ultracode also paints the prompt rules as a rainbow cycle.
 */
export type { ClaudeEffort, ClaudeMode };

const MODES: Record<
  ClaudeMode,
  { glyph: string; label: string; color: string; hint: string }
> = {
  auto: {
    glyph: "⏵⏵",
    label: "auto mode on",
    color: "var(--cc-mode-auto)",
    hint: "(shift+tab to cycle) · ← for agents",
  },
  manual: {
    glyph: "⏸",
    label: "manual mode on",
    color: "var(--cc-mode-manual)",
    hint: "· ? for shortcuts · ← for agents",
  },
  "accept-edits": {
    glyph: "⏵⏵",
    label: "accept edits on",
    color: "var(--cc-mode-accept-edits)",
    hint: "(shift+tab to cycle) · ← for agents",
  },
  plan: {
    glyph: "⏸",
    label: "plan mode on",
    color: "var(--cc-mode-plan)",
    hint: "(shift+tab to cycle) · ← for agents",
  },
};

const EFFORTS: Record<
  ClaudeEffort,
  { glyph: string; label: string; rainbow?: boolean }
> = {
  low: { glyph: "○", label: "low · /effort" },
  medium: { glyph: "◐", label: "medium · /effort" },
  high: { glyph: "●", label: "high · /effort" },
  xhigh: { glyph: "◉", label: "xhigh · /effort" },
  max: { glyph: "◈", label: "max · /effort" },
  ultracode: {
    glyph: "✦",
    label: "ultracode · xhigh effort + dynamic workflows for maximum thoroughness",
    rainbow: true,
  },
};

/** shift+tab cycles the modes in this order, as Claude Code does. */
export const MODE_CYCLE = Object.keys(MODES) as ClaudeMode[];
/** `/effort` steps through the efforts in this order. */
export const EFFORT_CYCLE = Object.keys(EFFORTS) as ClaudeEffort[];

function next<T>(cycle: T[], current: T): T {
  const at = cycle.indexOf(current);
  return cycle[(at + 1) % cycle.length] as T;
}

/**
 * What a control has to say to look like the text upstream draws.
 *
 * The stylesheet ships no Preflight, so nothing has reset the user agent's
 * form-control rules — a control that says nothing here is painted as a raised
 * grey box with Arial in it, sitting above the composer's rules. A `textarea`
 * is the same story with a scrollbar and a resize grip on the end. Said on the
 * controls themselves rather than in a `button, textarea {}` rule, because
 * resetting a host's elements is exactly what this package refuses to do.
 */
const RESET =
  "cc:m-0 cc:appearance-none cc:border-0 cc:bg-transparent cc:[font:inherit] cc:text-inherit";
/** The chip and the mode line draw as bare text: no padding of their own. */
const CONTROL = `${RESET} cc:p-0`;

/**
 * How tall the field may grow before it scrolls, in lines. Past this the
 * composer would push the Transcript off the top of the screen.
 */
const MAX_LINES = 10;

export function ClaudePrompt({
  value,
  defaultValue = "",
  onChange,
  onKeyDown,
  onSubmit,
  onModeChange,
  onEffortChange,
  placeholder = "",
  mode = "auto",
  effort = "xhigh",
  className,
  inputClassName,
}: {
  value?: string;
  defaultValue?: string;
  onChange?: React.ChangeEventHandler<HTMLTextAreaElement>;
  onKeyDown?: React.KeyboardEventHandler<HTMLTextAreaElement>;
  /** Enter (without shift) reports what is in the field. shift+Enter does not. */
  onSubmit?: (value: string) => void;
  /** shift+tab, or activating the mode line, reports the next mode. */
  onModeChange?: (mode: ClaudeMode) => void;
  /** Activating the effort chip reports the next effort. */
  onEffortChange?: (effort: ClaudeEffort) => void;
  placeholder?: string;
  mode?: ClaudeMode;
  /** Effort chip above the prompt. Pass `false` to hide. */
  effort?: ClaudeEffort | false;
  className?: string;
  inputClassName?: string;
}) {
  const m = MODES[mode];
  const e = effort === false ? null : EFFORTS[effort];
  const controlled = value !== undefined;
  const rainbow = Boolean(e?.rainbow);

  const field = React.useRef<HTMLTextAreaElement>(null);

  /**
   * A textarea stays `rows` tall whatever is in it, so the height is measured
   * rather than declared: clear it, read what the content wants, take that.
   * `max-height` does the capping, so a long prompt scrolls instead of eating
   * the Transcript.
   */
  function fit() {
    const el = field.current;
    if (!el) return;
    el.style.height = "auto";
    // A layout-less environment (jsdom, happy-dom, a hidden ancestor) measures
    // zero; collapsing the composer to nothing is worse than leaving it be.
    if (el.scrollHeight > 0) el.style.height = `${el.scrollHeight}px`;
  }

  // Controlled: the value can change with nobody typing — taking a slash
  // command completes the text from outside. Uncontrolled: `handleChange`.
  React.useLayoutEffect(fit, [value]);

  function handleChange(event: React.ChangeEvent<HTMLTextAreaElement>) {
    fit();
    onChange?.(event);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    onKeyDown?.(event);
    if (event.defaultPrevented) return;

    if (event.key === "Enter" && !event.shiftKey && onSubmit) {
      event.preventDefault();
      onSubmit(event.currentTarget.value);
      return;
    }
    if (event.key === "Tab" && event.shiftKey && onModeChange) {
      event.preventDefault();
      onModeChange(next(MODE_CYCLE, mode));
    }
  }

  const effortChip = e ? (
    <span className="cc:min-w-0 cc:break-words cc:text-right">
      <span aria-hidden>{e.glyph}</span> {e.label}
    </span>
  ) : null;

  const modeLine = (
    <>
      <span style={{ color: m.color }}>
        <span aria-hidden>{m.glyph} </span>
        {m.label}
      </span>
      {m.hint ? (
        <span style={{ color: "var(--cc-muted)" }}> {m.hint}</span>
      ) : null}
    </>
  );

  return (
    <div
      className={cn(
        "cc:min-w-0 cc:font-mono cc:text-[13px] cc:leading-[1.6]",
        className,
      )}
    >
      {e ? (
        <div
          className="cc:flex cc:justify-end cc:px-1 cc:pb-1 cc:text-[12px]"
          style={{ color: "var(--cc-muted)" }}
        >
          {onEffortChange && effort !== false ? (
            <button
              type="button"
              className={cn(CONTROL, "cc:min-w-0 cc:cursor-pointer cc:text-right")}
              onClick={() => onEffortChange(next(EFFORT_CYCLE, effort))}
            >
              {effortChip}
            </button>
          ) : (
            effortChip
          )}
        </div>
      ) : null}

      <div
        className="cc:flex cc:min-w-0 cc:items-start cc:gap-0 cc:border-y cc:py-0.5"
        style={
          rainbow
            ? {
                borderImageSource: "var(--cc-ultracode-rainbow)",
                borderImageSlice: 1,
                borderTopWidth: 1,
                borderBottomWidth: 1,
                borderTopStyle: "solid",
                borderBottomStyle: "solid",
              }
            : { borderColor: "var(--cc-rule)" }
        }
      >
        <span
          aria-hidden
          className="cc:shrink-0 cc:pl-0 cc:pr-0"
          style={{ color: "var(--cc-fg)" }}
        >
          ❯
        </span>
        <textarea
          ref={field}
          rows={1}
          aria-label="Prompt"
          placeholder={placeholder}
          onKeyDown={handleKeyDown}
          {...(controlled
            ? { value, onChange: handleChange }
            : { defaultValue, onChange: handleChange })}
          className={cn(
            RESET,
            // The row's breathing room is the wrapper's `py-0.5`, not the
            // field's own: without Preflight the field is content-box, so a
            // height taken from `scrollHeight` — which counts padding — would
            // leave it its own padding too tall at every height. With no
            // vertical padding the measurement is exact, and `box-sizing`
            // stays out of a stylesheet that resets nothing.
            "cc-term-input cc:block cc:min-w-0 cc:flex-1 cc:resize-none cc:overflow-y-auto cc:py-0 cc:pl-[1ch] cc:pr-0 cc:outline-none cc:placeholder:text-[var(--cc-fg-dim)]",
            inputClassName,
          )}
          style={
            {
              color: "var(--cc-fg)",
              caretColor: "var(--cc-fg)",
              caretShape: "block",
              // Tracks `leading-[1.6]` on the container, which the field
              // inherits along with the rest of `font`.
              maxHeight: `calc(1.6em * ${MAX_LINES})`,
            } as React.CSSProperties
          }
        />
      </div>

      <div className="cc:mt-1.5 cc:min-w-0 cc:break-words cc:px-1 cc:text-[12px]">
        {onModeChange ? (
          <button
            type="button"
            className={cn(CONTROL, "cc:cursor-pointer cc:text-left")}
            onClick={() => onModeChange(next(MODE_CYCLE, mode))}
          >
            {modeLine}
          </button>
        ) : (
          modeLine
        )}
      </div>
    </div>
  );
}
