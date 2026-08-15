import { afterEach, describe, expect, jest, test } from "bun:test";
import { act, render, screen } from "@testing-library/react";
import { ClaudeThinking } from "./claude-thinking.tsx";

afterEach(() => {
  jest.useRealTimers();
});

/** Moves the clock and lets React redraw what the clock changed. */
function tick(ms: number): void {
  act(() => {
    jest.advanceTimersByTime(ms);
  });
}

/** What the working line reads, minus the stylesheet it carries inline. */
function line(): string {
  const status = screen.getByRole("status");
  const styles = status.querySelectorAll("style");
  const text = status.textContent ?? "";
  let stripped = text;
  for (const style of styles) stripped = stripped.replace(style.textContent ?? "", "");
  return stripped;
}

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
    render(
      <ClaudeThinking showTokens={false} tokens={120345} verbs={["Thinking"]} />,
    );
    expect(screen.getByRole("status").textContent).not.toContain("tokens");
  });

  test("shows the count it was given, rather than one of its own", () => {
    render(<ClaudeThinking showTokens tokens={120345} verbs={["Thinking"]} />);
    // The number has to be the caller's. Upstream drew `secs * 137` here — a
    // plausible, rising, entirely invented figure — which is indistinguishable
    // from a real reading right up until someone believes it.
    expect(screen.getByRole("status").textContent).toContain("120,345 tokens");
  });

  test("says nothing about tokens until there is a reading to say", () => {
    render(<ClaudeThinking showTokens verbs={["Thinking"]} />);
    // Asked for the count and given none. `↑ 0 tokens` would be the line
    // reporting a measurement nobody took, and a viewer cannot tell that from
    // a context window that is genuinely empty.
    expect(screen.getByRole("status").textContent).not.toContain("tokens");
    // The rest of the line is still there — the absence is the number alone,
    // not the working line going quiet.
    expect(screen.getByRole("status").textContent).toContain("esc to interrupt");
  });

  test("a reading of zero is a reading, and is shown", () => {
    render(<ClaudeThinking showTokens tokens={0} verbs={["Thinking"]} />);
    // The distinction the test above rests on: absent is not zero, and zero is
    // not absent. Suppressing a real zero would be the same silence by the
    // other door.
    expect(screen.getByRole("status").textContent).toContain("0 tokens");
  });

  test("the elapsed count advances while the Turn runs", () => {
    jest.useFakeTimers();
    render(<ClaudeThinking verbs={["Thinking"]} showTokens={false} />);

    expect(line()).toContain("(0s");
    tick(3000);
    // The positive control for the test below. Without it, "the meter stopped"
    // is a claim a meter that never moved in the first place would also pass —
    // frozen and correctly-stopped read identically from the outside.
    expect(line()).toContain("(3s");
  });

  test("the meter stops when the Turn ends, and the next Turn starts from nothing", () => {
    jest.useFakeTimers();
    const view = render(<ClaudeThinking verbs={["Thinking"]} showTokens={false} />);

    tick(3000);
    expect(line()).toContain("(3s");

    // The Turn ends. The clock keeps going — a person reading the answer for a
    // minute — and the meter must not be counting through it.
    act(() => {
      view.rerender(<ClaudeThinking running={false} verbs={["Thinking"]} showTokens={false} />);
    });
    tick(60_000);
    expect(screen.queryByRole("status")).toBe(null);

    // The next Turn. This is where a meter that merely *paused* gives itself
    // away: it comes back reading 3s — or 63s, if it never stopped at all —
    // and either way the elapsed is a lie about a Turn that just began.
    act(() => {
      view.rerender(<ClaudeThinking running verbs={["Thinking"]} showTokens={false} />);
    });
    expect(line()).toContain("(0s");
    tick(2000);
    // And it is a live meter again, not one stuck at the zero it was reset to.
    expect(line()).toContain("(2s");
  });
});
