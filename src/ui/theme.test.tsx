import { beforeAll, describe, expect, test } from "bun:test";
import { render } from "@testing-library/react";
import { buildStylesheet, flattenLayers } from "../../test/build-css.ts";
import { ClaudeHeader } from "./claude-header.tsx";
import { ClaudeMessage } from "./claude-message.tsx";

/** tokyo-night defaults, as `theme.css` ships them. */
const DEFAULT_ACCENT = "#cd694a";
const DEFAULT_FG = "#c0caf5";

beforeAll(async () => {
  const style = document.createElement("style");
  style.textContent = flattenLayers(await buildStylesheet());
  document.head.appendChild(style);
});

describe("theming", () => {
  test("draws in tokyo-night with nothing overridden", () => {
    const { container } = render(<ClaudeHeader />);
    const legend = container.querySelector("legend") as HTMLElement;
    expect(getComputedStyle(legend).color).toBe(DEFAULT_ACCENT);
  });

  test("overriding a custom property re-themes an inline-styled element", () => {
    const { container } = render(
      <div style={{ ["--cc-accent" as string]: "rgb(0, 128, 0)" }}>
        <ClaudeHeader />
      </div>,
    );
    const legend = container.querySelector("legend") as HTMLElement;
    expect(getComputedStyle(legend).color).toBe("rgb(0, 128, 0)");
  });

  test("the agent's prose takes its colour from the built stylesheet", () => {
    const { container } = render(
      <ClaudeMessage role="assistant">the agent's prose</ClaudeMessage>,
    );
    const prose = container.firstElementChild as HTMLElement;
    expect(getComputedStyle(prose).color).toBe(DEFAULT_FG);
  });

  test("overriding a custom property re-themes what the stylesheet draws", () => {
    const { container } = render(
      <div style={{ ["--cc-fg" as string]: "rgb(17, 17, 17)" }}>
        <ClaudeMessage role="assistant">the agent's prose</ClaudeMessage>
      </div>,
    );
    const prose = container.firstElementChild?.firstElementChild as HTMLElement;
    expect(getComputedStyle(prose).color).toBe("rgb(17, 17, 17)");
  });

  test("a person's Message row re-themes too", () => {
    const { container } = render(
      <div style={{ ["--cc-user-bg" as string]: "rgb(9, 9, 9)" }}>
        <ClaudeMessage role="user">fix the flaky test</ClaudeMessage>
      </div>,
    );
    const row = container.firstElementChild?.firstElementChild as HTMLElement;
    expect(getComputedStyle(row).backgroundColor).toBe("rgb(9, 9, 9)");
  });
});
