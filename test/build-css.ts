/** Compiles `src/ui/tailwind.css` and returns the built stylesheet's text. */
export async function buildStylesheet(): Promise<string> {
  const root = new URL("../", import.meta.url).pathname;
  const build = Bun.spawnSync(["bun", "run", "build:css"], { cwd: root });
  if (build.exitCode !== 0) {
    throw new Error(`build:css failed: ${build.stderr.toString()}`);
  }
  return await Bun.file(`${root}dist/styles.css`).text();
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
