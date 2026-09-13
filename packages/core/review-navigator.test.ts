import { describe, expect, test } from "bun:test";
import {
  navigatorPairFromLegacyPanelView,
  resolveStoredNavigatorGrouping,
  resolveStoredNavigatorLayout,
} from "./review-navigator";

describe("navigatorPairFromLegacyPanelView", () => {
  test("maps the retired three-way panel view onto the layout/grouping pair", () => {
    // Failure caught: an upgrading reviewer landing in a different navigator
    // than the one they were using. The old `tree` view was an ungrouped
    // directory hierarchy and `sections` was a flat git-status list.
    expect(navigatorPairFromLegacyPanelView("tree")).toEqual({ layout: "tree", grouping: "all" });
    expect(navigatorPairFromLegacyPanelView("sections")).toEqual({ layout: "flat", grouping: "status" });
  });

  test("the session-only Commits view has no mapping", () => {
    // It was never persisted, so a cookie holding it (or anything else) must
    // read as "nothing stored" rather than pinning a pair.
    expect(navigatorPairFromLegacyPanelView("commits")).toBeUndefined();
    expect(navigatorPairFromLegacyPanelView("")).toBeUndefined();
    expect(navigatorPairFromLegacyPanelView(null)).toBeUndefined();
    expect(navigatorPairFromLegacyPanelView(42)).toBeUndefined();
  });
});

describe("stored navigator resolution", () => {
  test("a current value wins over both legacy cookies", () => {
    expect(resolveStoredNavigatorLayout("flat", "tree", "tree")).toBe("flat");
    expect(resolveStoredNavigatorGrouping("all", "sections", "sections")).toBe("all");
  });

  test("the last-used memo migrates ahead of the persisted default", () => {
    // Failure caught: migrating the stale opening default over the view the
    // reviewer was actually last using — the memo shadowed it before.
    expect(resolveStoredNavigatorLayout(null, "tree", "sections")).toBe("tree");
    expect(resolveStoredNavigatorGrouping(null, "tree", "sections")).toBe("all");
  });

  test("the persisted default migrates when no memo was recorded", () => {
    expect(resolveStoredNavigatorLayout(null, null, "sections")).toBe("flat");
    expect(resolveStoredNavigatorGrouping(null, null, "sections")).toBe("status");
  });

  test("a reviewer with nothing stored resolves to undefined, not a guess", () => {
    // undefined is what lets the registry fall through to its default AND
    // what first-run seeding reads as "never chose" before writing.
    expect(resolveStoredNavigatorLayout(null, null, null)).toBeUndefined();
    expect(resolveStoredNavigatorGrouping(undefined, undefined, undefined)).toBeUndefined();
  });

  test("a garbage current value falls through to migration rather than being kept", () => {
    expect(resolveStoredNavigatorLayout("nested", null, "sections")).toBe("flat");
    expect(resolveStoredNavigatorGrouping("by-author", null, "tree")).toBe("all");
  });
});
