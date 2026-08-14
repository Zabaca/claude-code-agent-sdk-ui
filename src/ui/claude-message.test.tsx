import { describe, expect, test } from "bun:test";
import { render, screen } from "@testing-library/react";
import { ClaudeMessage } from "./claude-message.tsx";

describe("ClaudeMessage", () => {
  test("renders a person's words from literal props", () => {
    render(<ClaudeMessage role="user">fix the flaky test</ClaudeMessage>);
    expect(screen.getByText("fix the flaky test")).toBeDefined();
  });

  test("renders the agent's prose from literal props", () => {
    render(<ClaudeMessage role="assistant">I looked at the suite.</ClaudeMessage>);
    expect(screen.getByText("I looked at the suite.")).toBeDefined();
  });

  test("keeps a consumer's className", () => {
    const { container } = render(
      <ClaudeMessage className="mine">hello</ClaudeMessage>,
    );
    expect(container.querySelector(".mine")).not.toBeNull();
  });
});
