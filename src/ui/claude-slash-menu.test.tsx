import { describe, expect, test } from "bun:test";
import { fireEvent, render, screen } from "@testing-library/react";
import { ClaudeSlashMenu } from "./claude-slash-menu.tsx";

const COMMANDS = [
  { name: "/clear", description: "Clear conversation history" },
  { name: "/compact", description: "Summarize the conversation" },
  { name: "/model", description: "Change the model for this Session" },
];

describe("ClaudeSlashMenu", () => {
  test("renders commands from literal props", () => {
    render(<ClaudeSlashMenu commands={COMMANDS} />);
    expect(screen.getAllByRole("option")).toHaveLength(3);
    expect(screen.getByText("Change the model for this Session")).toBeDefined();
  });

  test("sits above the composer it filters", () => {
    render(<ClaudeSlashMenu commands={COMMANDS} />);
    expect(screen.getByLabelText("Prompt")).toBeDefined();
  });

  test("filters as the person types", () => {
    render(<ClaudeSlashMenu commands={COMMANDS} />);

    fireEvent.change(screen.getByLabelText("Prompt"), {
      target: { value: "/co" },
    });

    const names = screen.getAllByRole("option").map((o) => o.textContent);
    expect(names?.length).toBe(1);
    expect(names[0]).toContain("/compact");
  });

  test("arrow keys move the active option", () => {
    render(<ClaudeSlashMenu commands={COMMANDS} />);
    const input = screen.getByLabelText("Prompt");

    expect(screen.getAllByRole("option")[0]?.getAttribute("aria-selected")).toBe("true");

    fireEvent.keyDown(input, { key: "ArrowDown" });

    expect(screen.getAllByRole("option")[1]?.getAttribute("aria-selected")).toBe("true");
  });

  test("wraps the active option round the ends", () => {
    render(<ClaudeSlashMenu commands={COMMANDS} />);
    const input = screen.getByLabelText("Prompt");

    fireEvent.keyDown(input, { key: "ArrowUp" });

    expect(screen.getAllByRole("option")[2]?.getAttribute("aria-selected")).toBe("true");
  });
});
