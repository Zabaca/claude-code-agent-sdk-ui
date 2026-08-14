import { describe, expect, test } from "bun:test";
import { render, screen } from "@testing-library/react";
import { ClaudeToolCall } from "./claude-tool-call.tsx";

describe("ClaudeToolCall", () => {
  test("renders a settled call from literal props", () => {
    render(
      <ClaudeToolCall tool="Read" arg="src/core/classify.ts" result="128 lines" />,
    );
    expect(screen.getByText("Read")).toBeDefined();
    expect(screen.getByText("src/core/classify.ts")).toBeDefined();
    expect(screen.getByText("128 lines")).toBeDefined();
  });

  test("renders a call that has no result yet as pending", () => {
    render(<ClaudeToolCall tool="Bash" arg="bun test" status="pending" />);

    const line = screen.getByRole("group");
    expect(line.getAttribute("data-status")).toBe("pending");
    // The status is announced, not only coloured.
    expect(screen.getByText("pending")).toBeDefined();
  });

  test("an in-flight call still renders its tool and argument", () => {
    render(<ClaudeToolCall tool="Bash" arg="bun test" status="pending" />);
    expect(screen.getByText("Bash")).toBeDefined();
    expect(screen.getByText("bun test")).toBeDefined();
  });

  test("expands to its full output through the children slot", () => {
    render(
      <ClaudeToolCall tool="Read" result="128 lines" defaultOpen>
        the whole file
      </ClaudeToolCall>,
    );
    expect(screen.getByText("the whole file")).toBeDefined();
  });

  test("marks its status for every state", () => {
    for (const status of ["success", "error", "pending"] as const) {
      const { container } = render(
        <ClaudeToolCall tool="Read" result="done" status={status} />,
      );
      expect(
        container.querySelector(`[data-status="${status}"]`),
      ).not.toBeNull();
    }
  });
});
