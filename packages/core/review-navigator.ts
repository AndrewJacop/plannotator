/**
 * The unified review navigator's two independent display choices.
 *
 * `layout` decides how a collection of files is drawn (a flat list, or an
 * expandable directory hierarchy) and `grouping` decides which collections
 * exist (one combined set, or Staged / Unstaged / Committed sections). They
 * are orthogonal by construction: all four combinations are valid, and a
 * writer of one never touches the other.
 *
 * Browser-safe and dependency-free so the settings registry and the review
 * app can share the guards; the cookie plumbing lives in
 * `packages/ui/config/settings.ts`.
 */

export type ReviewNavigatorLayout = "flat" | "tree";
export type ReviewNavigatorGrouping = "all" | "status";

export function isReviewNavigatorLayout(value: unknown): value is ReviewNavigatorLayout {
  return value === "flat" || value === "tree";
}

export function isReviewNavigatorGrouping(value: unknown): value is ReviewNavigatorGrouping {
  return value === "all" || value === "status";
}

/**
 * How the retired three-way panel view maps onto the pair.
 *
 * The old `tree` view was an ungrouped directory hierarchy and the old
 * `sections` view was a flat list grouped by git status, so each legacy value
 * names exactly one point in the new space. `commits` was session-only and was
 * never persisted, so it has no mapping and reads as "nothing stored".
 */
export function navigatorPairFromLegacyPanelView(
  value: unknown,
): { layout: ReviewNavigatorLayout; grouping: ReviewNavigatorGrouping } | undefined {
  if (value === "tree") return { layout: "tree", grouping: "all" };
  if (value === "sections") return { layout: "flat", grouping: "status" };
  return undefined;
}

/**
 * Resolve the stored layout: the current cookie if it is valid, else the
 * retired panel-view cookies (last-used first, then the persisted default).
 *
 * Migration happens on READ and is never written back — a migrating read
 * returns a value, so the registry's default-seeding write never fires and the
 * resolution stays pure and identical on every load until the reviewer touches
 * the control. Same shape as the `tokenHoverCards` → `tokenHoverTrigger`
 * migration.
 */
export function resolveStoredNavigatorLayout(
  stored: string | null | undefined,
  legacyLastUsed: string | null | undefined,
  legacyPersisted: string | null | undefined,
): ReviewNavigatorLayout | undefined {
  if (isReviewNavigatorLayout(stored)) return stored;
  return (
    navigatorPairFromLegacyPanelView(legacyLastUsed)?.layout ??
    navigatorPairFromLegacyPanelView(legacyPersisted)?.layout
  );
}

/** Grouping half of {@link resolveStoredNavigatorLayout}. */
export function resolveStoredNavigatorGrouping(
  stored: string | null | undefined,
  legacyLastUsed: string | null | undefined,
  legacyPersisted: string | null | undefined,
): ReviewNavigatorGrouping | undefined {
  if (isReviewNavigatorGrouping(stored)) return stored;
  return (
    navigatorPairFromLegacyPanelView(legacyLastUsed)?.grouping ??
    navigatorPairFromLegacyPanelView(legacyPersisted)?.grouping
  );
}
