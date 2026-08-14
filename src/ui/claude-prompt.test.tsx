import { describe, expect, test } from "bun:test";
import { fireEvent, render, screen } from "@testing-library/react";
import { ClaudePrompt } from "./claude-prompt.tsx";

describe("ClaudePrompt", () => {
  test("renders from literal props", () => {
    render(<ClaudePrompt placeholder="Try a prompt" mode="plan" effort="max" />);
    expect(screen.getByPlaceholderText("Try a prompt")).toBeDefined();
    expect(screen.getByText("plan mode on")).toBeDefined();
    expect(screen.getByText(/max/)).toBeDefined();
  });

  test("hides the effort chip when effort is false", () => {
    render(<ClaudePrompt effort={false} />);
    expect(screen.queryByText(/\/effort/)).toBeNull();
  });

  test("reports submit with the current value on Enter", () => {
    const submitted: string[] = [];
    render(
      <ClaudePrompt value="ship it" onChange={() => {}} onSubmit={(v) => submitted.push(v)} />,
    );

    fireEvent.keyDown(screen.getByLabelText("Prompt"), { key: "Enter" });

    expect(submitted).toEqual(["ship it"]);
  });

  test("does not report submit on shift+Enter", () => {
    const submitted: string[] = [];
    render(
      <ClaudePrompt value="line one" onChange={() => {}} onSubmit={(v) => submitted.push(v)} />,
    );

    fireEvent.keyDown(screen.getByLabelText("Prompt"), {
      key: "Enter",
      shiftKey: true,
    });

    expect(submitted).toEqual([]);
  });

  test("reports submit for an uncontrolled composer", () => {
    const submitted: string[] = [];
    render(<ClaudePrompt defaultValue="from the input" onSubmit={(v) => submitted.push(v)} />);

    fireEvent.keyDown(screen.getByLabelText("Prompt"), { key: "Enter" });

    expect(submitted).toEqual(["from the input"]);
  });

  test("reports the next mode on shift+Tab", () => {
    const modes: string[] = [];
    render(<ClaudePrompt mode="auto" onModeChange={(m) => modes.push(m)} />);

    fireEvent.keyDown(screen.getByLabelText("Prompt"), {
      key: "Tab",
      shiftKey: true,
    });

    expect(modes).toEqual(["manual"]);
  });

  test("wraps the mode cycle round to the start", () => {
    const modes: string[] = [];
    render(<ClaudePrompt mode="plan" onModeChange={(m) => modes.push(m)} />);

    fireEvent.click(screen.getByRole("button", { name: /plan mode on/ }));

    expect(modes).toEqual(["auto"]);
  });

  test("reports the next effort from the effort chip", () => {
    const efforts: string[] = [];
    render(<ClaudePrompt effort="high" onEffortChange={(e) => efforts.push(e)} />);

    fireEvent.click(screen.getByRole("button", { name: /xhigh|high/ }));

    expect(efforts).toEqual(["xhigh"]);
  });

  test("wraps the effort cycle round to the start", () => {
    const efforts: string[] = [];
    render(<ClaudePrompt effort="ultracode" onEffortChange={(e) => efforts.push(e)} />);

    fireEvent.click(screen.getByRole("button", { name: /ultracode/ }));

    expect(efforts).toEqual(["low"]);
  });

  test("stays inert chrome when no callbacks are given", () => {
    render(<ClaudePrompt mode="auto" effort="high" />);
    expect(screen.queryAllByRole("button")).toEqual([]);
  });

  test("still forwards onChange and onKeyDown to the caller", () => {
    const seen: string[] = [];
    render(
      <ClaudePrompt
        onChange={(e) => seen.push(`change:${e.target.value}`)}
        onKeyDown={(e) => seen.push(`key:${e.key}`)}
      />,
    );

    const input = screen.getByLabelText("Prompt");
    fireEvent.change(input, { target: { value: "hi" } });
    fireEvent.keyDown(input, { key: "a" });

    expect(seen).toEqual(["change:hi", "key:a"]);
  });
});
