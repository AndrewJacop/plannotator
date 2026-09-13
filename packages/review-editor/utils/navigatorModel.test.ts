import { describe, expect, test } from 'bun:test';
import type { SinceBaseSections } from '@plannotator/shared/types';
import {
  buildNavigatorStatusGroups,
  buildNavigatorTree,
  navigatorTreeFileOrder,
  resolveEffectiveGrouping,
  resolveGroupingCapability,
  type NavigatorFileItem,
  type NavigatorRow,
} from './navigatorModel';

function row(path: string, extra: Partial<NavigatorRow> = {}): NavigatorRow {
  return { path, status: 'modified', additions: 1, deletions: 1, ...extra };
}

function sections(files: SinceBaseSections['files']): SinceBaseSections {
  return { base: 'origin/main', mergeBase: 'abc123', files };
}

describe('buildNavigatorStatusGroups', () => {
  test('untracked files join Unstaged while keeping their untracked flag', () => {
    // Failure caught: untracked work disappearing when the separate Untracked
    // section was folded into Unstaged, or losing the `U` status letter that
    // is the only thing distinguishing it from a tracked edit.
    const groups = buildNavigatorStatusGroups(
      [row('new.ts', { status: 'added' }), row('edited.ts')],
      sections({
        'new.ts': { group: 'untracked', staged: false },
        'edited.ts': { group: 'changes', staged: false },
      }),
      new Set(),
    );
    expect(groups.staged).toEqual([]);
    expect(groups.unstaged.map((i) => [i.row.path, i.untracked])).toEqual([
      ['new.ts', true],
      ['edited.ts', false],
    ]);
  });

  test('files with only committed work belong to neither section', () => {
    // They are the Committed section's business, reached through commit rows.
    const groups = buildNavigatorStatusGroups(
      [row('committed.ts'), row('dirty.ts')],
      sections({ 'dirty.ts': { group: 'changes', staged: false } }),
      new Set(),
    );
    expect(groups.staged).toEqual([]);
    expect(groups.unstaged.map((i) => i.row.path)).toEqual(['dirty.ts']);
  });

  test('the effective staged set decides the section, never the sidecar snapshot', () => {
    // Staging display invariant: the sidecar's `staged` flag is a SNAPSHOT.
    // ORing it back in would keep a file unstaged this session rendering under
    // Staged and invert the next toggle.
    const files = sections({ 'a.ts': { group: 'changes', staged: true } });
    const staged = buildNavigatorStatusGroups([row('a.ts')], files, new Set(['a.ts']));
    expect(staged.staged.map((i) => i.row.path)).toEqual(['a.ts']);

    const unstagedNow = buildNavigatorStatusGroups([row('a.ts')], files, new Set());
    expect(unstagedNow.staged).toEqual([]);
    expect(unstagedNow.unstaged.map((i) => i.row.path)).toEqual(['a.ts']);
  });

  test('staging an untracked file moves it out of untracked before the server catches up', () => {
    const groups = buildNavigatorStatusGroups(
      [row('new.ts', { status: 'added' })],
      sections({ 'new.ts': { group: 'untracked', staged: false } }),
      new Set(['new.ts']),
    );
    expect(groups.staged[0].untracked).toBe(false);
  });

  test('unstaging a staged ADD returns it to untracked', () => {
    const groups = buildNavigatorStatusGroups(
      [row('new.ts', { status: 'added' })],
      sections({ 'new.ts': { group: 'changes', staged: true } }),
      new Set(),
    );
    expect(groups.unstaged[0].untracked).toBe(true);
  });

  test('with no sidecar every file reads as committed, so nothing is invented', () => {
    const groups = buildNavigatorStatusGroups([row('a.ts')], null, new Set());
    expect(groups.staged).toEqual([]);
    expect(groups.unstaged).toEqual([]);
  });
});

describe('buildNavigatorTree', () => {
  const items = (paths: string[]): NavigatorFileItem[] =>
    paths.map((p) => ({ row: row(p, { additions: 2, deletions: 1 }), untracked: false, staged: false }));

  test('merges single-child folder chains and sorts folders before files', () => {
    const tree = buildNavigatorTree(items(['src/deep/nested/a.ts', 'src/deep/nested/b.ts', 'README.md']));
    expect(tree.map((n) => [n.type, n.name])).toEqual([
      ['folder', 'src/deep/nested'],
      ['file', 'README.md'],
    ]);
  });

  test('a folder holding one file suppresses its totals as redundant', () => {
    // The issue asks for directory totals "where useful" — a folder whose only
    // child is a file would just restate that row's numbers.
    const tree = buildNavigatorTree(items(['pkg/only.ts', 'pkg2/a.ts', 'pkg2/b.ts']));
    const byName = Object.fromEntries(tree.map((n) => [n.name, n]));
    expect(byName['pkg'].type).toBe('folder');
    expect((byName['pkg'] as { redundantTotals: boolean }).redundantTotals).toBe(true);
    expect((byName['pkg2'] as { redundantTotals: boolean }).redundantTotals).toBe(false);
    expect(byName['pkg2'].additions).toBe(4);
  });

  test('a collapsed folder hides its files from the keyboard walk order', () => {
    const tree = buildNavigatorTree(items(['src/a.ts', 'src/b.ts', 'top.ts']));
    const key = (p: string) => `w:${p}`;
    expect(navigatorTreeFileOrder(tree, new Set(), key).map((i) => i.row.path)).toEqual([
      'src/a.ts',
      'src/b.ts',
      'top.ts',
    ]);
    // Folders are expanded unless explicitly COLLAPSED — a refreshed diff that
    // introduces a new directory must not need a re-seeding pass to be walked.
    expect(navigatorTreeFileOrder(tree, new Set([key('src')]), key).map((i) => i.row.path)).toEqual(['top.ts']);
  });
});

describe('grouping availability', () => {
  test('a plain local git session can group', () => {
    expect(resolveGroupingCapability({ isPR: false, isWorkspace: false, vcsType: 'git' }).available).toBe(true);
  });

  test('sessions without a git index cannot, each with its own reason', () => {
    // Failure caught: three empty section headers with no explanation in a PR,
    // workspace or jj review.
    const pr = resolveGroupingCapability({ isPR: true, isWorkspace: false, vcsType: 'git' });
    const workspace = resolveGroupingCapability({ isPR: false, isWorkspace: true });
    const jj = resolveGroupingCapability({ isPR: false, isWorkspace: false, vcsType: 'jj' });
    for (const capability of [pr, workspace, jj]) {
      expect(capability.available).toBe(false);
      expect(capability.reason.length).toBeGreaterThan(0);
    }
    expect(jj.reason).toContain('jj');
  });
});

describe('resolveEffectiveGrouping', () => {
  const capable = { available: true, reason: '' };

  test('All renders as All and never carries a reason', () => {
    expect(resolveEffectiveGrouping({ selected: 'all', capability: capable, hasSections: true })).toEqual({
      grouping: 'all',
      fallbackReason: '',
    });
  });

  test('a session that cannot group falls back to All with the session reason', () => {
    const incapable = { available: false, reason: 'no index here' };
    const resolved = resolveEffectiveGrouping({ selected: 'status', capability: incapable, hasSections: true });
    expect(resolved.grouping).toBe('all');
    expect(resolved.fallbackReason).toBe('no index here');
  });

  test('a diff with no git-status partition falls back to All with a stated reason', () => {
    // Failure caught: the retired coupling coming back as a silent setting
    // rewrite. The SELECTION survives, so returning to a partitionable diff
    // restores the sections without the reviewer re-picking.
    const resolved = resolveEffectiveGrouping({ selected: 'status', capability: capable, hasSections: false });
    expect(resolved.grouping).toBe('all');
    expect(resolved.fallbackReason.length).toBeGreaterThan(0);
  });

  test('a partitionable diff in a capable session renders the sections', () => {
    expect(
      resolveEffectiveGrouping({ selected: 'status', capability: capable, hasSections: true }),
    ).toEqual({ grouping: 'status', fallbackReason: '' });
  });
});
