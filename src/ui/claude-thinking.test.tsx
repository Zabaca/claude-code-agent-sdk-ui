import { describe, expect, test } from "bun:test";
import { render, screen } from "@testing-library/react";
import { ClaudeThinking } from "./claude-thinking.tsx";

describe("ClaudeThinking", () => {
  test("renders the working line while the Turn runs", () => {
    render(<ClaudeThinking verbs={["Percolating"]} />);

    const line = screen.getByRole("status");
    expect(line.textContent).toContain("Percolating…");
    expect(line.textContent).toContain("esc to interrupt");
  });

  test("draws nothing once the Turn is no longer running", () => {
    const { container } = render(<ClaudeThinking running={false} />);
    expect(container.innerHTML).toBe("");
  });

  test("is a polite live region, so silence is never ambiguous", () => {
    render(<ClaudeThinking />);
    expect(screen.getByRole("status").getAttribute("aria-live")).toBe("polite");
  });

  test("omits the token count when showTokens is off", () => {
    render(<ClaudeThinking showTokens={false} verbs={["Thinking"]} />);
    expect(screen.getByRole("status").textContent).not.toContain("tokens");
  });

  test("shows the token count when showTokens is on", () => {
    render(<ClaudeThinking showTokens verbs={["Thinking"]} />);
    expect(screen.getByRole("status").textContent).toContain("tokens");
  });
});
