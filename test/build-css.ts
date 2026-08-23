import { packageCopy } from "./package-copy.ts";

/**
 * Compiles `src/ui/tailwind.css` and returns the built stylesheet's text.
 *
 * The build happens in a disposable copy of the package, not in the tree. See
 * `package-copy.ts`: `dist/` is a shared mutable path, and a second suite
 * running beside this one is the normal case rather than the exotic one.
 *
 * `bun run build:css` and not a hand-rebuilt `tailwindcss` argv — the project
 * command is the thing under test, and a test that reassembles it is a test of
 * the reassembly.
 */
export async function buildStylesheet(): Promise<string> {
  const copy = packageCopy("styles");
  try {
    const build = Bun.spawnSync(["bun", "run", "build:css"], { cwd: copy.dir });
    if (build.exitCode !== 0) {
      throw new Error(`build:css failed: ${build.stderr.toString()}`);
    }
    return await Bun.file(`${copy.dir}/dist/styles.css`).text();
  } finally {
    copy.remove();
  }
}

/**
 * happy-dom does not implement `@layer`, so rules inside one never match when
 * the built stylesheet is injected into a test document. Unwrapping the layer
 * blocks leaves the selectors and declarations exactly as the build emitted
 * them — only the cascade-ordering wrapper goes.
 */
export function flattenLayers(css: string): string {
  const opener = /@layer\s+[\w-]+\s*\{/;
  let out = "";
  let rest = css;

  for (;;) {
    const match = opener.exec(rest);
    if (!match) return out + rest;

    out += rest.slice(0, match.index);
    let depth = 1;
    let at = match.index + match[0].length;
    const body = at;
    while (at < rest.length && depth > 0) {
      if (rest[at] === "{") depth += 1;
      else if (rest[at] === "}") depth -= 1;
      at += 1;
    }
    out += rest.slice(body, at - 1);
    rest = rest.slice(at);
  }
}
