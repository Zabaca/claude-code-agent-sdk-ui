/**
 * Vendored from Brainless — https://github.com/theswerd/brainless (MIT)
 * Upstream file: registry/brainless/claude/claude-todo-list.tsx
 * Upstream commit: 4c5d5ab65ff6cfa8dbb6f27cb8c88d9092a48deb (2026-07-14)
 *
 * Local changes:
 *   - `cn` comes from ./lib/cn instead of `@/lib/utils`
 *   - Tailwind utilities carry the `cc:` prefix (see ./tailwind.css)
 *   - Hardcoded tokyo-night hex lifted into `--cc-*` custom properties
 */
import { cn } from "./lib/cn.ts";

/**
 * ClaudeTodoList — Claude Code's task list (TaskCreate / TaskUpdate).
 *
 * Capture grammar (v2.1.207), with one intentional deviation: icons stay in a
 * single column. Real Claude puts `  ⎿ ` before the first ✔ (space + nbsp),
 * which shoves that check a cell right of a natural `⎿ ` pairing — we use a
 * single space after ⎿ so ✔ / ◼ / ◻ line up.
 *
 *   ⎿ ✔ done     (green + strikethrough)
 *     ◼ active   (terracotta + bold)
 *     ◻ pending  (default foreground)
 */
export type Todo = {
  label: string;
  status: "done" | "active" | "todo";
};

const ICON: Record<Todo["status"], string> = {
  done: "✔",
  active: "◼",
  todo: "◻",
};

export function ClaudeTodoList({
  todos,
  className,
}: {
  todos: Todo[];
  className?: string;
}) {
  return (
    <ol className={cn("cc:font-mono cc:text-[13px] cc:leading-[1.6]", className)}>
      {todos.map((t, i) => {
        const iconColor =
          t.status === "done"
            ? "var(--cc-todo-done)"
            : t.status === "active"
              ? "var(--cc-todo-active)"
              : undefined;

        return (
          <li key={i} className="cc:whitespace-pre">
            {/*
              First row: "  ⎿ " then icon. Later rows: four spaces so the
              icon column lines up under ✔ (no capture-style nbsp jump).
            */}
            <span aria-hidden style={{ color: "var(--cc-muted)" }}>
              {i === 0 ? "  ⎿ " : "    "}
            </span>
            <span aria-hidden style={{ color: iconColor }}>
              {ICON[t.status]}{" "}
            </span>
            <span
              className={cn(
                t.status === "done" && "cc:line-through",
                t.status === "active" && "cc:font-semibold",
              )}
              style={{
                color: t.status === "done" ? "var(--cc-muted)" : undefined,
              }}
            >
              {t.label}
              <span className="cc:sr-only">
                {" "}
                ({t.status === "done"
                  ? "completed"
                  : t.status === "active"
                    ? "in progress"
                    : "pending"})
              </span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
