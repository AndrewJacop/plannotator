/**
 * The review navigator's layout + grouping settings.
 *
 * Two failures worth guarding. (1) An upgrading reviewer's retired
 * `reviewPanelView` / `reviewPanelViewLastUsed` cookies silently evaporating,
 * dropping them into the built-in default instead of the navigator matching
 * what they were using. (2) The old coupling coming back — layout, grouping
 * and `defaultDiffType` are independent now, and a setter that quietly rewrote
 * another key is exactly the split-brain bug the coupled pair produced.
 */
import { afterEach, describe, expect, test } from 'bun:test';
import { resetStorageBackend, setStorageBackend } from '../utils/storage';
import { ConfigStoreForTest } from './configStore';
import {
  hasPersistedNavigatorChoice,
  setReviewDefaultDiffType,
  setReviewNavigatorGrouping,
  setReviewNavigatorLayout,
} from './reviewView';
import { SETTINGS } from './settings';

const LAYOUT_KEY = 'plannotator-review-navigator-layout';
const GROUPING_KEY = 'plannotator-review-navigator-grouping';
const LEGACY_VIEW_KEY = 'plannotator-review-panel-view';
const LEGACY_LAST_USED_KEY = 'plannotator-review-panel-view-last-used';

function installBackend(seed: Record<string, string> = {}): Map<string, string> {
  const values = new Map(Object.entries(seed));
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

describe('navigator settings registry', () => {
  test('round-trips both values and rejects anything else', () => {
    const values = installBackend();

    for (const layout of ['flat', 'tree'] as const) {
      SETTINGS.reviewNavigatorLayout.toCookie(layout);
      expect(SETTINGS.reviewNavigatorLayout.fromCookie()).toBe(layout);
    }
    for (const grouping of ['all', 'status'] as const) {
      SETTINGS.reviewNavigatorGrouping.toCookie(grouping);
      expect(SETTINGS.reviewNavigatorGrouping.fromCookie()).toBe(grouping);
    }

    values.set(LAYOUT_KEY, 'nested');
    values.set(GROUPING_KEY, 'by-author');
    expect(SETTINGS.reviewNavigatorLayout.fromCookie()).toBeUndefined();
    expect(SETTINGS.reviewNavigatorGrouping.fromCookie()).toBeUndefined();
  });

  test('a reviewer who used the Git status view lands on Flat + By Git status', () => {
    installBackend({ [LEGACY_VIEW_KEY]: 'sections' });
    expect(SETTINGS.reviewNavigatorLayout.fromCookie()).toBe('flat');
    expect(SETTINGS.reviewNavigatorGrouping.fromCookie()).toBe('status');
  });

  test('a reviewer who used the Tree view lands on Tree + All', () => {
    installBackend({ [LEGACY_VIEW_KEY]: 'tree' });
    expect(SETTINGS.reviewNavigatorLayout.fromCookie()).toBe('tree');
    expect(SETTINGS.reviewNavigatorGrouping.fromCookie()).toBe('all');
  });

  test('migration never writes the new cookies back', () => {
    // A migrating READ returns a value, so the registry's default-seeding
    // write never fires and resolution stays identical on every load. The
    // reviewer's legacy cookies are also left intact, so a downgrade still
    // finds them.
    const values = installBackend({ [LEGACY_LAST_USED_KEY]: 'sections' });
    expect(SETTINGS.reviewNavigatorLayout.fromCookie()).toBe('flat');
    expect(SETTINGS.reviewNavigatorGrouping.fromCookie()).toBe('status');
    expect(values.has(LAYOUT_KEY)).toBe(false);
    expect(values.has(GROUPING_KEY)).toBe(false);
    expect(values.get(LEGACY_LAST_USED_KEY)).toBe('sections');
  });

  test('a migrated value stops migrating once the reviewer touches the control', () => {
    const values = installBackend({ [LEGACY_VIEW_KEY]: 'sections' });
    SETTINGS.reviewNavigatorLayout.toCookie('tree');
    expect(values.get(LAYOUT_KEY)).toBe('tree');
    expect(SETTINGS.reviewNavigatorLayout.fromCookie()).toBe('tree');
    // The other half is untouched — the two controls are independent.
    expect(SETTINGS.reviewNavigatorGrouping.fromCookie()).toBe('status');
  });
});

describe('hasPersistedNavigatorChoice', () => {
  test('is false only when the reviewer has expressed nothing at all', () => {
    installBackend();
    expect(hasPersistedNavigatorChoice()).toBe(false);
  });

  test('a retired panel-view cookie counts as a choice', () => {
    // Failure caught: first-run seeding treating an upgrading reviewer as new
    // and resetting them to the recommended pair.
    installBackend({ [LEGACY_VIEW_KEY]: 'sections' });
    expect(hasPersistedNavigatorChoice()).toBe(true);
  });

  test('one half of the new pair is enough', () => {
    installBackend({ [GROUPING_KEY]: 'all' });
    expect(hasPersistedNavigatorChoice()).toBe(true);
  });
});

describe('setters are independent', () => {
  test('choosing a layout changes neither the grouping nor the default diff', () => {
    installBackend();
    const store = makeStore();
    setReviewNavigatorGrouping('status', store);
    setReviewDefaultDiffType('since-base', store);

    setReviewNavigatorLayout('flat', store);
    expect(store.get('reviewNavigatorGrouping')).toBe('status');
    expect(store.get('defaultDiffType')).toBe('since-base');
  });

  test('choosing a classic diff default no longer snaps the navigator', () => {
    // Failure caught: the retired sections ⟺ since-base coupling creeping
    // back, which used to force the panel to Tree whenever a reviewer picked
    // a non-composite default diff.
    installBackend();
    const store = makeStore();
    setReviewNavigatorLayout('tree', store);
    setReviewNavigatorGrouping('status', store);

    setReviewDefaultDiffType('uncommitted', store);
    expect(store.get('reviewNavigatorLayout')).toBe('tree');
    expect(store.get('reviewNavigatorGrouping')).toBe('status');
    expect(store.get('defaultDiffType')).toBe('uncommitted');
  });

  test('choosing By Git status does not persist a diff default', () => {
    installBackend();
    const store = makeStore();
    setReviewDefaultDiffType('uncommitted', store);
    setReviewNavigatorGrouping('status', store);
    expect(store.get('defaultDiffType')).toBe('uncommitted');
  });
});
