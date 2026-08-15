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

  test("leaves shift+Enter to the browser, so it opens a second line", () => {
    // Not sending is only half of it. The newline is the user agent's default
    // action on a multi-line field, so two things have to hold: the field is a
    // textarea — an input cannot hold a second line at all — and shift+Enter
    // reaches the default. `fireEvent` returns false when something called
    // `preventDefault`, which is what swallowing the newline would look like.
    render(<ClaudePrompt value="line one" onChange={() => {}} onSubmit={() => {}} />);
    const field = screen.getByLabelText("Prompt");

    expect(field.tagName).toBe("TEXTAREA");
    expect(fireEvent.keyDown(field, { key: "Enter", shiftKey: true })).toBe(true);
    expect(fireEvent.keyDown(field, { key: "Enter" })).toBe(false);
  });

  test("sends every line of a multi-line prompt", () => {
    const submitted: string[] = [];
    render(
      <ClaudePrompt value={"one\ntwo"} onChange={() => {}} onSubmit={(v) => submitted.push(v)} />,
    );

    fireEvent.keyDown(screen.getByLabelText("Prompt"), { key: "Enter" });

    expect(submitted).toEqual(["one\ntwo"]);
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

  test("draws its own controls as text, not as the browser's button chrome", () => {
    // Two decisions from #4 collide here. Upstream draws the effort chip and
    // the mode line as spans; `onEffortChange`/`onModeChange` make them real
    // buttons. Preflight is deliberately out of the stylesheet, because a
    // component library has no business resetting its host's page — and
    // Preflight is exactly what normally neutralises a button's border,
    // background, padding and font. So each control has to neutralise its own.
    //
    // The breakage: drop any one of these from either control — or add a third
    // control without them — and the user agent paints a raised grey box with
    // Arial in it, floating above the composer's rules.
    const view = render(
      <ClaudePrompt effort="high" onEffortChange={() => {}} onModeChange={() => {}} />,
    );
    const controls = screen.getAllByRole("button");
    expect(controls).toHaveLength(2);

    for (const control of controls) {
      const drawn = control.className.split(/\s+/);
      for (const neutralised of [
        "cc:appearance-none",
        "cc:border-0",
        "cc:p-0",
        "cc:m-0",
        "cc:[font:inherit]",
        "cc:text-inherit",
        "cc:bg-transparent",
      ]) {
        expect(drawn).toContain(neutralised);
      }
    }
    view.unmount();
  });

  test("draws the field as bare text, not as the browser's textarea chrome", () => {
    // Same collision as above, and the one that shipped visibly wrong: with no
    // Preflight in the stylesheet, an unneutralised field paints the user
    // agent's own inset border and background — a box drawn inside the
    // composer's two rules, with a resize grip on the corner. Drop any of these
    // and the box comes back.
    render(<ClaudePrompt />);
    const drawn = screen.getByLabelText("Prompt").className.split(/\s+/);

    for (const neutralised of [
      "cc:appearance-none",
      "cc:border-0",
      "cc:m-0",
      "cc:[font:inherit]",
      "cc:text-inherit",
      "cc:bg-transparent",
      "cc:resize-none",
    ]) {
      expect(drawn).toContain(neutralised);
    }
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
