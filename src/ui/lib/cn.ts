/**
 * Local equivalent of upstream Brainless's `cn` from `@/lib/utils`.
 *
 * Upstream composes `clsx` with `tailwind-merge`. This package keeps React as
 * its only peer and carries no runtime dependencies, so `cn` here is the
 * dependency-free subset the vendored components actually use: join the truthy
 * class values in order. Conflicting utilities are not de-duplicated — a
 * consumer's `className` lands last in the attribute and wins on ordering, not
 * on merge.
 */
export type ClassValue = string | false | null | undefined;

export function cn(...values: ClassValue[]): string {
  return values.filter(Boolean).join(" ");
}
