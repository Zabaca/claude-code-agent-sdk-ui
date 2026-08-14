/**
 * Vendored from Brainless — https://github.com/theswerd/brainless (MIT)
 * Upstream file: registry/brainless/claude/claude-diff.tsx
 * Upstream commit: 4c5d5ab65ff6cfa8dbb6f27cb8c88d9092a48deb (2026-07-14)
 *
 * Local changes:
 *   - `cn` comes from ./lib/cn instead of `@/lib/utils`
 *   - Tailwind utilities carry the `cc:` prefix (see ./tailwind.css)
 *   - Hardcoded tokyo-night hex lifted into `--cc-*` custom properties
 */
import { cn } from "./lib/cn.ts";

/**
 * ClaudeDiff — Claude Code's inline edit hunk (the ⏺ Update / ⎿ summary + the
 * +/- lines). Added/removed rows carry semantic tinted backgrounds and an
 * off-screen "added"/"removed" label so the diff is legible without color.
 */
export type DiffLine = {
  type: "add" | "del" | "ctx";
  n?: number;
  text: string;
};

export function ClaudeDiff({
  file,
  summary,
  lines,
  className,
}: {
  file: string;
  summary?: string;
  lines: DiffLine[];
  className?: string;
}) {
  return (
    <div
      className={cn(
        "cc:min-w-0 cc:font-mono cc:text-[13px] cc:leading-[1.55]",
        className,
      )}
    >
      <div className="cc:flex cc:min-w-0 cc:flex-wrap cc:items-baseline cc:gap-x-2">
        <span
          aria-hidden
          className="cc:shrink-0"
          style={{ color: "var(--cc-success)" }}
        >
          ⏺
        </span>
        <span className="cc:text-[var(--cc-fg)]">Update</span>
        <span className="cc:min-w-0 cc:break-all">
          <span className="cc:text-[var(--cc-fg-dim)]">(</span>
          <span className="cc:text-[var(--cc-info)]">{file}</span>
          <span className="cc:text-[var(--cc-fg-dim)]">)</span>
        </span>
      </div>
      {summary ? (
        <div className="cc:flex cc:min-w-0 cc:items-baseline cc:gap-2 cc:text-[var(--cc-fg-muted)]">
          {/* invisible status glyph spacer: aligns ⎿ under "Update" */}
          <span aria-hidden className="cc:invisible cc:shrink-0">
            ⏺
          </span>
          <span
            aria-hidden
            className="cc:shrink-0"
            style={{ color: "var(--cc-fg-dim)" }}
          >
            ⎿
          </span>
          <span className="cc:min-w-0 cc:break-words">{summary}</span>
        </div>
      ) : null}

      <pre className="cc:mt-1 cc:min-w-0 cc:overflow-x-auto cc:rounded-none cc:border cc:border-[var(--cc-diff-border)] cc:bg-[var(--cc-diff-bg)] cc:py-1.5 cc:pl-2 cc:pr-3">
        {lines.map((l, i) => {
          const bg =
            l.type === "add"
              ? "var(--cc-diff-add-bg)"
              : l.type === "del"
                ? "var(--cc-diff-del-bg)"
                : "transparent";
          const mark = l.type === "add" ? "+" : l.type === "del" ? "-" : " ";
          const markColor =
            l.type === "add"
              ? "var(--cc-success)"
              : l.type === "del"
                ? "var(--cc-error)"
                : "var(--cc-fg-dim)";
          return (
            <div key={i} className="cc:flex cc:min-w-0" style={{ background: bg }}>
              <span
                className="cc:w-9 cc:shrink-0 cc:select-none cc:pr-2 cc:text-right"
                style={{ color: "var(--cc-diff-gutter)" }}
              >
                {l.n ?? ""}
              </span>
              <span
                className="cc:w-3 cc:shrink-0 cc:select-none"
                style={{ color: markColor }}
              >
                {mark}
              </span>
              <span
                className="cc:min-w-0 cc:break-all"
                style={{
                  color:
                    l.type === "ctx" ? "var(--cc-fg-muted)" : "var(--cc-fg)",
                }}
              >
                {l.type !== "ctx" ? (
                  <span className="cc:sr-only">
                    {l.type === "add" ? "added: " : "removed: "}
                  </span>
                ) : null}
                {l.text}
              </span>
            </div>
          );
        })}
      </pre>
    </div>
  );
}
