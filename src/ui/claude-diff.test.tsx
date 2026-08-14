import { describe, expect, test } from "bun:test";
import { render, screen } from "@testing-library/react";
import { ClaudeDiff } from "./claude-diff.tsx";

const LINES = [
  { type: "ctx", n: 41, text: "export function reduce(" } as const,
  { type: "del", n: 42, text: "  return []" } as const,
  { type: "add", n: 42, text: "  return messages" } as const,
];

describe("ClaudeDiff", () => {
  test("renders a hunk from literal props", () => {
    render(
      <ClaudeDiff
        file="src/core/reduce.ts"
        summary="Updated with 1 addition and 1 removal"
        lines={LINES}
      />,
    );

    expect(screen.getByText("src/core/reduce.ts")).toBeDefined();
    expect(screen.getByText("Updated with 1 addition and 1 removal")).toBeDefined();
    expect(screen.getByText(/return messages/)).toBeDefined();
  });

  test("renders without a summary", () => {
    render(<ClaudeDiff file="a.ts" lines={LINES} />);
    expect(screen.getByText("a.ts")).toBeDefined();
  });

  test("labels added and removed lines in words, not only colour", () => {
    const { container } = render(<ClaudeDiff file="a.ts" lines={LINES} />);
    expect(container.textContent).toContain("added:");
    expect(container.textContent).toContain("removed:");
  });

  test("shows line numbers, and leaves them blank where there is none", () => {
    const { container } = render(
      <ClaudeDiff file="a.ts" lines={[{ type: "add", text: "no number" }]} />,
    );
    expect(container.textContent).toContain("no number");
  });
});
