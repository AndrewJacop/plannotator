import { afterEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resetStorageBackend, setStorageBackend } from '@plannotator/ui/utils/storage';
import { ConfigStoreForTest } from '../../ui/config/configStore';
import {
  initializeReviewSetup,
  needsReviewSetup,
  shouldOfferReviewSetup,
} from './reviewSetup';
import type { ReviewSetupSession } from './reviewSetup';

function installMemoryBackend(initial: Readonly<Record<string, string>> = {}): Map<string, string> {
  const values = new Map(Object.entries(initial));
  setStorageBackend({
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
    removeItem: (key) => { values.delete(key); },
  });
  return values;
}

function makeStore(): ConfigStoreForTest {
  const store = new ConfigStoreForTest();
  store.setServerSync(() => {});
  return store;
}

afterEach(() => {
  resetStorageBackend();
});

describe('initializeReviewSetup', () => {
  test('a genuinely new reviewer starts on Tree + All while keeping the since-base diff default', () => {
    installMemoryBackend();
    const store = makeStore();

    expect(initializeReviewSetup(store)).toBe(true);
    expect(store.get('reviewNavigatorLayout')).toBe('tree');
    expect(store.get('reviewNavigatorGrouping')).toBe('all');
    expect(store.get('defaultDiffType')).toBe('since-base');
    expect(needsReviewSetup()).toBe(false);
  });

  test('an unseen reviewer inherits an existing classic diff default', () => {
    // Failure caught: seeding the navigator pair dragging the diff default
    // with it, which is exactly the coupling the navigator removed.
    installMemoryBackend({
      'plannotator-default-diff-type': 'uncommitted',
    });
    const store = makeStore();

    expect(initializeReviewSetup(store)).toBe(true);
    expect(store.get('reviewNavigatorLayout')).toBe('tree');
    expect(store.get('reviewNavigatorGrouping')).toBe('all');
    expect(store.get('defaultDiffType')).toBe('uncommitted');
  });

  test('an unseen reviewer inherits a local-vs-remote default', () => {
    installMemoryBackend({
      'plannotator-default-diff-type': 'local-vs-remote',
    });
    const store = makeStore();

    expect(initializeReviewSetup(store)).toBe(true);
    expect(store.get('reviewNavigatorLayout')).toBe('tree');
    expect(store.get('defaultDiffType')).toBe('local-vs-remote');
  });

  test('an explicit persisted choice survives a session that never tripped the seen gate', () => {
    // Non-git / workspace / PR / no-since-base sessions never reach the
    // initializer, so a reviewer can persist a navigator preference from
    // Settings while "seen" stays unset. The next plain git session must not
    // seed over it.
    installMemoryBackend({
      'plannotator-review-navigator-layout': 'flat',
      'plannotator-review-navigator-grouping': 'status',
    });
    const store = makeStore();

    expect(initializeReviewSetup(store)).toBe(false);
    expect(store.get('reviewNavigatorLayout')).toBe('flat');
    expect(store.get('reviewNavigatorGrouping')).toBe('status');
    // The one-time setup is consumed, so this cannot be re-evaluated later.
    expect(needsReviewSetup()).toBe(false);
  });

  test('a retired panel-view cookie counts as a persisted choice and is not seeded over', () => {
    // Failure caught: an upgrading reviewer whose only stored preference is
    // the old cookie getting silently reset to Tree + All on their next
    // review, because the seen gate happens to be unset for them.
    installMemoryBackend({
      'plannotator-review-panel-view': 'sections',
    });
    const store = makeStore();

    expect(initializeReviewSetup(store)).toBe(false);
    expect(store.get('reviewNavigatorLayout')).toBe('flat');
    expect(store.get('reviewNavigatorGrouping')).toBe('status');
    expect(needsReviewSetup()).toBe(false);
  });

  test('a returning reviewer keeps their persisted pair', () => {
    installMemoryBackend({
      'plannotator-review-setup-seen': 'true',
      'plannotator-review-navigator-layout': 'flat',
      'plannotator-review-navigator-grouping': 'all',
      'plannotator-default-diff-type': 'since-base',
    });
    const store = makeStore();

    expect(initializeReviewSetup(store)).toBe(false);
    expect(store.get('reviewNavigatorLayout')).toBe('flat');
    expect(store.get('reviewNavigatorGrouping')).toBe('all');
    expect(store.get('defaultDiffType')).toBe('since-base');
  });
});

function plainGitSession(overrides: Partial<ReviewSetupSession> = {}): ReviewSetupSession {
  return {
    hasGitContext: true,
    isWorkspace: false,
    isPR: false,
    vcsType: 'git',
    sinceBaseAvailable: true,
    ...overrides,
  };
}

describe('shouldOfferReviewSetup', () => {
  test('a caller-pinned session never offers the dialog', () => {
    // Failure caught: a pinned session opening a dialog whose dismiss handler
    // runs handleDiffSwitch(defaultDiffType) — silently discarding --base /
    // --diff-type.
    expect(shouldOfferReviewSetup(plainGitSession({ openStatePinned: true }))).toBe(false);
  });

  test('an ordinary plain-git session still offers it', () => {
    // Failure caught: over-broad guards silently disabling first-run setup
    // for everyone.
    expect(shouldOfferReviewSetup(plainGitSession())).toBe(true);
    expect(shouldOfferReviewSetup(plainGitSession({ openStatePinned: false }))).toBe(true);
  });

  test('the pre-existing disqualifiers still apply', () => {
    expect(shouldOfferReviewSetup(plainGitSession({ hasGitContext: false }))).toBe(false);
    expect(shouldOfferReviewSetup(plainGitSession({ isWorkspace: true }))).toBe(false);
    expect(shouldOfferReviewSetup(plainGitSession({ isPR: true }))).toBe(false);
    expect(shouldOfferReviewSetup(plainGitSession({ vcsType: 'jj' }))).toBe(false);
    expect(shouldOfferReviewSetup(plainGitSession({ sinceBaseAvailable: false }))).toBe(false);
  });

  test('a pinned mount leaves the one-time seen cookie unset', () => {
    // Failure caught: burning the reviewer's one-time setup on a session that
    // never showed it — the reason the predicate must precede (and
    // short-circuit past) initializeReviewSetup() in App's && chain.
    installMemoryBackend();
    const store = makeStore();
    const offered =
      shouldOfferReviewSetup(plainGitSession({ openStatePinned: true })) &&
      initializeReviewSetup(store);
    expect(offered).toBe(false);
    expect(needsReviewSetup()).toBe(true);
  });

  test('App composes the predicate BEFORE initializeReviewSetup in the && chain', () => {
    // Source-level pin: initializeReviewSetup() consumes the seen cookie as a
    // side effect of being CALLED, so ordering (not just the boolean result)
    // is the implementation. A refactor that calls initializeReviewSetup()
    // first would pass every pure test above while still burning the cookie.
    const appSource = readFileSync(join(import.meta.dir, '..', 'App.tsx'), 'utf-8');
    expect(appSource).toMatch(/shouldOfferReviewSetup\(\{[\s\S]{0,400}?\}\)\s*&&\s*initializeReviewSetup\(\)/);
  });
});
