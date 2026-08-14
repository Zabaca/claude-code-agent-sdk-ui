"use client";

/**
 * Vendored from Brainless — https://github.com/theswerd/brainless (MIT)
 * Upstream file: registry/brainless/claude/claude-slash-menu.tsx
 * Upstream commit: 4c5d5ab65ff6cfa8dbb6f27cb8c88d9092a48deb (2026-07-14)
 *
 * Upstream declares a registry dependency on `claude-prompt`; that
 * relationship is kept here as a local import of ./claude-prompt.
 *
 * Local changes:
 *   - `cn` comes from ./lib/cn instead of `@/lib/utils`
 *   - `ClaudePrompt` comes from ./claude-prompt instead of the registry path
 *   - Tailwind utilities carry the `cc:` prefix (see ./tailwind.css)
 *   - Hardcoded tokyo-night hex lifted into `--cc-*` custom properties
 */
import * as React from "react";
import { ClaudePrompt } from "./claude-prompt.tsx";
import { cn } from "./lib/cn.ts";

/**
 * ClaudeSlashMenu — Claude Code's slash-command palette.
 *
 * The command list sits above the real ClaudePrompt composer. Typing after
 * `/` in that input filters by command-name prefix; arrow keys move the
 * active option. Active rows are light blue; inactive rows are gray. Both
 * keep the same fixed-width name column so selection never shifts text.
 */
export type SlashCommand = { name: string; description: string };

const DEFAULT: SlashCommand[] = [
  { name: "/agents", description: "Manage subagents for specialized tasks" },
  { name: "/clear", description: "Clear conversation history and free up context" },
  { name: "/compact", description: "Summarize the conversation to save context" },
  { name: "/init", description: "Initialize a CLAUDE.md with codebase docs" },
  { name: "/model", description: "Change the model for this session" },
  { name: "/review", description: "Review a pull request" },
];

const NAME_COLS = 37; // matches Claude Code's padded name column

export function ClaudeSlashMenu({
  commands = DEFAULT,
  className,
}: {
  commands?: SlashCommand[];
  className?: string;
}) {
  const [value, setValue] = React.useState("/");
  const [active, setActive] = React.useState(0);

  const query = value.startsWith("/") ? value.slice(1) : value;
  const list = commands.filter((c) =>
    c.name.slice(1).toLowerCase().startsWith(query.toLowerCase()),
  );
  const clampedActive = list.length ? Math.min(active, list.length - 1) : 0;

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!list.length) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => (a + 1) % list.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => (a - 1 + list.length) % list.length);
    }
  }

  return (
    <div
      className={cn(
        "cc:font-mono cc:text-[13px] cc:leading-[1.6]",
        className,
      )}
    >
      <ul
        role="listbox"
        aria-label="Slash commands"
        aria-activedescendant={list.length ? `slash-${clampedActive}` : undefined}
        className="cc:mb-2 cc:space-y-0.5"
      >
        {list.map((c, i) => {
          const activeRow = i === clampedActive;
          return (
            <li
              key={c.name}
              id={`slash-${i}`}
              role="option"
              aria-selected={activeRow}
              onMouseEnter={() => setActive(i)}
              className="cc:cursor-pointer cc:truncate cc:px-1 cc:py-0.5"
              style={{
                color: activeRow
                  ? "var(--cc-slash-active)"
                  : "var(--cc-slash-inactive)",
              }}
            >
              <span
                className="cc:inline-block"
                style={{ width: `${NAME_COLS}ch` }}
              >
                {c.name}
              </span>
              {c.description}
            </li>
          );
        })}
      </ul>

      <ClaudePrompt
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          setActive(0);
        }}
        onKeyDown={onKeyDown}
        mode="auto"
      />
    </div>
  );
}
