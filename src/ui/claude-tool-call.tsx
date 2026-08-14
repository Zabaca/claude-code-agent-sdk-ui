/**
 * Vendored from Brainless — https://github.com/theswerd/brainless (MIT)
 * Upstream file: registry/brainless/claude/claude-tool-call.tsx
 * Upstream commit: 4c5d5ab65ff6cfa8dbb6f27cb8c88d9092a48deb (2026-07-14)
 *
 * Local changes:
 *   - `cn` comes from ./lib/cn instead of `@/lib/utils`
 *   - Tailwind utilities carry the `cc:` prefix (see ./tailwind.css)
 *   - Hardcoded tokyo-night hex lifted into `--cc-*` custom properties
 *   - `result` is optional, so a tool call still in flight renders as pending
 *     instead of requiring output it does not have yet. The status is also
 *     exposed as `data-status` and announced, so a failure is legible without
 *     colour. Offered upstream.
 */
import type * as React from "react";
import { cn } from "./lib/cn.ts";

/**
 * ClaudeToolCall — Claude Code's collapsed tool/result line.
 *
 * In the terminal this is faked with box-drawing glyphs and a "ctrl+o to
 * expand" hint. Here it's a real <details> disclosure: keyboard-operable,
 * announced to screen readers, and it keeps the exact ⏺ / ⎿ visual grammar.
 */
type Status = "success" | "error" | "pending";

const STATUS_COLOR: Record<Status, string> = {
  success: "var(--cc-success)",
  error: "var(--cc-error)",
  pending: "var(--cc-pending)",
};

const STATUS_LABEL: Record<Status, string> = {
  success: "success",
  error: "error",
  pending: "pending",
};

export function ClaudeToolCall({
  tool,
  arg,
  result,
  status = "success",
  defaultOpen = false,
  className,
  children,
}: {
  tool: string;
  arg?: string;
  /** Omit while the call is still in flight — the line renders as pending. */
  result?: string;
  status?: Status;
  defaultOpen?: boolean;
  className?: string;
  children?: React.ReactNode;
}) {
  const expandable = Boolean(children);
  const hasResult = result !== undefined;

  return (
    <details
      open={defaultOpen}
      data-status={status}
      className={cn(
        "cc:group cc:font-mono cc:text-[13px] cc:leading-[1.55] cc:[&_summary::-webkit-details-marker]:hidden",
        className,
      )}
    >
      <summary
        className={cn(
          "cc:list-none",
          expandable ? "cc:cursor-pointer" : "cc:cursor-default",
          "cc:rounded-none cc:outline-none cc:focus-visible:ring-1 cc:focus-visible:ring-[var(--cc-focus-ring)]",
        )}
      >
        <span className="cc:flex cc:min-w-0 cc:items-baseline cc:gap-2">
          <span
            aria-hidden
            className="cc:shrink-0"
            style={{ color: STATUS_COLOR[status] }}
          >
            ⏺
          </span>
          <span className="cc:min-w-0 cc:break-words">
            <span className="cc:text-[var(--cc-fg)]">{tool}</span>
            {arg !== undefined ? (
              <>
                <span className="cc:text-[var(--cc-fg-dim)]">(</span>
                <span className="cc:text-[var(--cc-info)]">{arg}</span>
                <span className="cc:text-[var(--cc-fg-dim)]">)</span>
              </>
            ) : null}
          </span>
        </span>
        <span className="cc:flex cc:min-w-0 cc:items-baseline cc:gap-2 cc:text-[var(--cc-fg-muted)]">
          {/* invisible status glyph spacer: aligns ⎿ under the tool name */}
          <span aria-hidden className="cc:invisible cc:shrink-0">
            ⏺
          </span>
          <span className="cc:flex cc:min-w-0 cc:items-baseline cc:gap-2">
            <span aria-hidden className="cc:shrink-0 cc:text-[var(--cc-fg-dim)]">
              ⎿
            </span>
            <span className="cc:min-w-0 cc:break-words">
              {hasResult ? result : STATUS_LABEL[status]}
              {hasResult ? (
                <span className="cc:sr-only"> {STATUS_LABEL[status]}</span>
              ) : null}
              {expandable ? (
                <span className="cc:ml-2 cc:text-[var(--cc-fg-dim)] cc:group-open:hidden">
                  (ctrl+o to expand)
                </span>
              ) : null}
            </span>
          </span>
        </span>
      </summary>

      {expandable ? (
        <div className="cc:mt-1 cc:whitespace-pre-wrap cc:pl-[32px] cc:text-[var(--cc-fg-muted)]">
          {children}
        </div>
      ) : null}
    </details>
  );
}
