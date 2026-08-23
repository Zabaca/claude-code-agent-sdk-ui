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
export async function buildStylesheet(): Promise<Built> {
  const copy = packageCopy("styles");
  try {
    const build = Bun.spawnSync(["bun", "run", "build:css"], { cwd: copy.dir });
    if (build.exitCode !== 0) {
      throw new Error(`build:css failed: ${build.stderr.toString()}`);
    }
    const css = await Bun.file(`${copy.dir}/dist/styles.css`).text();
    return { css, builtIn: copy.dir };
  } finally {
    copy.remove();
  }
}

/**
 * The stylesheet, and where it was built.
 *
 * `builtIn` is reported for one reason: it is the only order-independent way to
 * observe that the build did not happen in the working tree. The obvious check
 * — fingerprint `dist/` before and after — cannot see this particular write,
 * because **the Tailwind CLI does not rewrite an output whose content is
 * unchanged** (measured: two runs 1.1s apart left `mtime` identical). So on any
 * checkout that already has a matching `dist/styles.css`, a build into the tree
 * is invisible to a content fingerprint, and the mutation putting it back
 * survived the whole suite. The directory it wrote in is not invisible.
 *
 * The path is already removed by the time a caller sees it. It is evidence
 * about where the work happened, not a directory to go and read.
 */
export type Built = { css: string; builtIn: string };

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
