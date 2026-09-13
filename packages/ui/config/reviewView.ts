import type {
  ReviewNavigatorGrouping,
  ReviewNavigatorLayout,
} from '@plannotator/core/review-navigator';
import { configStore } from './configStore';
import { SETTINGS } from './settings';
import { storage } from '../utils/storage';

/**
 * The writers for the review navigator's display preferences.
 *
 * The unified navigator replaced the old three-way panel view, and with it the
 * coupled `(reviewPanelView, defaultDiffType)` pair: layout and grouping are
 * independent of each other AND of the diff. A grouping choice the active diff
 * cannot honour (no git-status partition) degrades to All *in the render*, with
 * a stated reason, instead of rewriting a setting behind the reviewer's back —
 * so there is no pair to keep consistent and no self-heal to run.
 *
 * These setters exist so call sites never touch the cookie keys directly and
 * so tests can inject a store.
 */

/** Store seam for tests (fresh ConfigStoreForTest); production always uses the singleton. */
type NavigatorConfigStore = typeof configStore;

export function setReviewNavigatorLayout(
  layout: ReviewNavigatorLayout,
  store: NavigatorConfigStore = configStore,
): void {
  store.set('reviewNavigatorLayout', layout);
}

export function setReviewNavigatorGrouping(
  grouping: ReviewNavigatorGrouping,
  store: NavigatorConfigStore = configStore,
): void {
  store.set('reviewNavigatorGrouping', grouping);
}

/**
 * Whether the reviewer has ever expressed a navigator preference — including
 * through the retired panel-view cookies, which both registry entries still
 * migrate on read. Distinct from `configStore.get(...)`, which cannot tell a
 * stored choice apart from the built-in default; that distinction is what
 * first-run seeding must respect before it writes over anything.
 */
export function hasPersistedNavigatorChoice(): boolean {
  return (
    SETTINGS.reviewNavigatorLayout.fromCookie() !== undefined ||
    SETTINGS.reviewNavigatorGrouping.fromCookie() !== undefined
  );
}

export type ReviewDefaultDiffType =
  | 'since-base'
  | 'local-vs-remote'
  | 'uncommitted'
  | 'unstaged'
  | 'staged'
  | 'merge-base'
  | 'all';

/**
 * The default diff a review opens on. Formerly coupled to the panel view
 * (a classic diff default snapped the view to Tree); the navigator renders
 * every diff in any layout, so this is now a plain write.
 */
export function setReviewDefaultDiffType(
  value: ReviewDefaultDiffType,
  store: NavigatorConfigStore = configStore,
): void {
  store.set('defaultDiffType', value);
}


/**
 * One-time gate for the auto-mark-viewed notice — the toast that fires the
 * FIRST time auto-view actually marks a file, i.e. the moment the feature
 * demonstrates itself. Cookie-based, mirroring the other review first-run
 * gates, so it survives the random port each session runs on. Versioned so a
 * meaningful revision can re-show it.
 *
 * It lives beside the setting rather than in the review app because BOTH
 * writers of the setting (Settings > Git here, and the file-list gear in the
 * review app) must consume the gate: someone who found the switch has
 * demonstrably discovered the feature and must never be told about it.
 */
const AUTO_VIEWED_NOTICE_SEEN_KEY = 'plannotator-auto-viewed-notice-seen';
const AUTO_VIEWED_NOTICE_VERSION = '1';

export function needsAutoViewedNotice(): boolean {
  return storage.getItem(AUTO_VIEWED_NOTICE_SEEN_KEY) !== AUTO_VIEWED_NOTICE_VERSION;
}

export function markAutoViewedNoticeSeen(): void {
  storage.setItem(AUTO_VIEWED_NOTICE_SEEN_KEY, AUTO_VIEWED_NOTICE_VERSION);
}

/**
 * The only writer of `reviewAutoViewed` outside the notice's own "Turn off"
 * action. Stamps the notice gate: an explicit toggle is proof of discovery.
 */
export function setReviewAutoViewed(
  value: boolean,
  store: NavigatorConfigStore = configStore,
): void {
  markAutoViewedNoticeSeen();
  store.set('reviewAutoViewed', value);
}
