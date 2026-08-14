import { describe, expect, test } from "bun:test";
import * as ui from "./index.ts";

describe("the ui entry point", () => {
  test("exports all eight vendored components", () => {
    for (const name of [
      "ClaudeHeader",
      "ClaudeMessage",
      "ClaudeThinking",
      "ClaudeToolCall",
      "ClaudeTodoList",
      "ClaudeDiff",
      "ClaudePrompt",
      "ClaudeSlashMenu",
    ]) {
      expect(typeof (ui as Record<string, unknown>)[name]).toBe("function");
    }
  });

  test("exports the container, which is ours rather than vendored", () => {
    expect(typeof (ui as Record<string, unknown>)["ClaudeSession"]).toBe(
      "function",
    );
  });

  test("does not export ClaudePermission (ADR-0003)", () => {
    expect(Object.keys(ui)).not.toContain("ClaudePermission");
  });
});
