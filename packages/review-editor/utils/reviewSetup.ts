import { storage } from '@plannotator/ui/utils/storage';
import {
  configStore,
  hasPersistedNavigatorChoice,
  setReviewNavigatorGrouping,
  setReviewNavigatorLayout,
} from '@plannotator/ui/config';

/**
 * First-run gate for the code-review setup dialog (panel-view default + the
 * tree view's default diff type). Cookie-based, mirroring the plan app's
 * look-and-feel announcement gate.
 */
const SEEN_KEY = 'plannotator-review-setup-seen';

export interface ReviewSetupSession {
  /** The caller pinned this session's opening diff (`--base` / `--diff-type`). */
  openStatePinned?: boolean;
  hasGitContext: boolean;
  isWorkspace: boolean;
  isPR: boolean;
  vcsType?: string;
  sinceBaseAvailable: boolean;
}

/**
 * Pure predicate for whether this session may offer the first-run setup dialog
 * at all. App composes `shouldOfferReviewSetup(…) && initializeReviewSetup()`
 * — the order is load-bearing, because initializeReviewSetup() consumes the
 * one-time seen cookie as a side effect of being CALLED. A caller-pinned
 * session must return false here so the cookie survives for the reviewer's
 * next ordinary review (same not-consumed precedent as the token-hover
 * announcement), and so the dialog's dismiss handler can never
 * handleDiffSwitch the flags away.
 */
export function shouldOfferReviewSetup(session: ReviewSetupSession): boolean {
  return (
    !session.openStatePinned &&
    session.hasGitContext &&
    !session.isWorkspace &&
    !session.isPR &&
    session.vcsType === 'git' &&
    session.sinceBaseAvailable
  );
}

export function needsReviewSetup(): boolean {
  return storage.getItem(SEEN_KEY) !== 'true';
}

export function markReviewSetupSeen(): void {
  storage.setItem(SEEN_KEY, 'true');
}

/**
 * Seed the setup choice for a genuinely new reviewer and mark the one-time
 * setup as consumed. Returning reviewers are left completely untouched so
 * their persisted view and last-used memo keep deciding the opening panel.
 *
 * @returns Whether the caller should show the first-run setup dialog.
 */
export function initializeReviewSetup(store: typeof configStore = configStore): boolean {
  if (!needsReviewSetup()) return false;

  // The seen cookie is not the only evidence of a returning reviewer. Sessions
  // that never reach this gate (non-git, workspace, PR, or no since-base) still
  // let Settings persist a navigator preference, so a reviewer can hold an
  // explicit choice while "seen" stays unset — and the retired panel-view
  // cookies, which the registry still migrates, count as one too. Seeding over
  // either would discard a real decision.
  if (hasPersistedNavigatorChoice()) {
    markReviewSetupSeen();
    return false;
  }

  // Tree + All is the recommended opening pair, and neither write touches
  // `defaultDiffType` — whichever diff the store resolved stays.
  setReviewNavigatorLayout('tree', store);
  setReviewNavigatorGrouping('all', store);
  markReviewSetupSeen();
  return true;
}
