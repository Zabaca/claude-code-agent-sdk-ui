import { beforeAll, describe, expect, test } from "bun:test";
import { Glob } from "bun";
import { buildStylesheet } from "../../test/build-css.ts";

const ROOT = new URL("../../", import.meta.url).pathname;

/** Utility classes the vendored components ask for, as written in the source. */
async function utilitiesUsed(): Promise<Set<string>> {
  const used = new Set<string>();
  for await (const file of new Glob("src/ui/*.tsx").scan(ROOT)) {
    if (file.endsWith(".test.tsx")) continue;
    const source = await Bun.file(`${ROOT}${file}`).text();
    for (const [token] of source.matchAll(/\bcc:[^\s"'`]+/g)) used.add(token);
  }
  return used;
}

let css = "";
/** Backslash escapes removed, so a selector can be searched for as written. */
let flat = "";

beforeAll(async () => {
  css = await buildStylesheet();
  flat = css.replaceAll("\\", "");
});

describe("the built stylesheet", () => {
  test("carries every utility the vendored components ask for", async () => {
    const missing = [...(await utilitiesUsed())].filter(
      (token) => !flat.includes(`.${token}`),
    );
    expect(missing).toEqual([]);
  });

  test("prefixes every class it defines", () => {
    const rules = flat.replace(/\/\*[\s\S]*?\*\//g, "");
    const classes = new Set(
      [...rules.matchAll(/\.(-?[A-Za-z_][^\s{,:>+~()[\]]*)/g)].map(
        (m) => m[1] as string,
      ),
    );
    const unprefixed = [...classes].filter((c) => !c.startsWith("cc"));
    expect(unprefixed).toEqual([]);
  });

  test("needs no Tailwind at the consumer — nothing is left to compile", () => {
    expect(css).not.toContain("@tailwind");
    expect(css).not.toContain("@source");
    expect(css).not.toContain('@import "');
    expect(css).not.toContain("@apply");
  });

  test("does not reset the host page", () => {
    // Preflight's giveaway rules. A component library styles itself only.
    expect(css).not.toContain("@layer base");
    expect(css).not.toContain("box-sizing: border-box");
  });

  test("ships the theme tokens the components draw with", () => {
    for (const token of [
      "--cc-fg",
      "--cc-accent",
      "--cc-success",
      "--cc-error",
      "--cc-pending",
      "--cc-diff-add-bg",
      "--cc-mode-auto",
      "--cc-slash-active",
    ]) {
      expect(css).toContain(`${token}:`);
    }
  });
});

describe("the vendored sources", () => {
  test("carry no hardcoded tokyo-night hex", async () => {
    const offenders: string[] = [];
    for await (const file of new Glob("src/ui/*.tsx").scan(ROOT)) {
      if (file.endsWith(".test.tsx")) continue;
      const source = await Bun.file(`${ROOT}${file}`).text();
      for (const [hex] of source.matchAll(/#[0-9a-fA-F]{3,8}\b/g)) {
        offenders.push(`${file}: ${hex}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  test("each record the upstream commit they were taken from", async () => {
    const expected = "4c5d5ab65ff6cfa8dbb6f27cb8c88d9092a48deb";
    const seen: string[] = [];
    for await (const file of new Glob("src/ui/claude-*.tsx").scan(ROOT)) {
      if (file.endsWith(".test.tsx")) continue;
      const source = await Bun.file(`${ROOT}${file}`).text();
      expect(source).toContain("https://github.com/theswerd/brainless");
      expect(source).toContain(`Upstream commit: ${expected}`);
      seen.push(file);
    }
    expect(seen).toHaveLength(8);
  });

  test("do not vendor ClaudePermission (ADR-0003)", async () => {
    const files: string[] = [];
    for await (const file of new Glob("src/ui/**/*.tsx").scan(ROOT)) {
      files.push(file);
    }
    expect(files.filter((f) => f.includes("permission"))).toEqual([]);
  });
});
