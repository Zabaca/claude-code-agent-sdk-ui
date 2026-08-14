/**
 * Vendored from Brainless — https://github.com/theswerd/brainless (MIT)
 * Upstream file: registry/brainless/claude/claude-message.tsx
 * Upstream commit: 4c5d5ab65ff6cfa8dbb6f27cb8c88d9092a48deb (2026-07-14)
 *
 * Local changes:
 *   - `cn` comes from ./lib/cn instead of `@/lib/utils`
 *   - Tailwind utilities carry the `cc:` prefix (see ./tailwind.css)
 *   - Hardcoded tokyo-night hex lifted into `--cc-*` custom properties
 */
import type * as React from "react";
import { cn } from "./lib/cn.ts";

/**
 * ClaudeMessage — a conversation turn. User turns render as Claude Code's
 * full-width prompt row (`❯` + one cell of space, dark background across the
 * row, white text); assistant turns are plain text.
 */
export function ClaudeMessage({
  role = "assistant",
  className,
  children,
}: {
  role?: "user" | "assistant";
  className?: string;
  children: React.ReactNode;
}) {
  if (role === "user") {
    return (
      <div
        className={cn(
          "cc:flex cc:w-full cc:min-w-0 cc:items-baseline cc:font-mono cc:text-[13px] cc:leading-[1.55]",
          className,
        )}
        style={{ background: "var(--cc-user-bg)" }}
      >
        <span
          aria-hidden
          className="cc:shrink-0"
          style={{ color: "var(--cc-user-caret)" }}
        >
          ❯
        </span>
        {/* one terminal cell between caret and text — a trailing space inside
            a flex child collapses, so use an explicit width */}
        <span
          aria-hidden
          className="cc:shrink-0"
          style={{ display: "inline-block", width: "1ch" }}
        />
        <span
          className="cc:min-w-0 cc:flex-1 cc:break-words"
          style={{ color: "var(--cc-user-fg)" }}
        >
          {children}
        </span>
      </div>
    );
  }
  return (
    <div
      className={cn(
        "cc:font-mono cc:text-[13px] cc:leading-[1.6] cc:text-[var(--cc-fg)]",
        className,
      )}
    >
      {children}
    </div>
  );
}
