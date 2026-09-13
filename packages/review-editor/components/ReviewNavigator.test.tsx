/**
 * DOM-gated coverage for the unified review navigator (#1524).
 *
 * The behaviors worth guarding are the ones the three retired modes could not
 * express: all four layout × grouping combinations rendering the SAME
 * changeset, a file picked inside a commit row producing a commit-scoped
 * selection (not a working-scope one on the same path), and a session that
 * cannot group by Git status saying so instead of showing empty sections.
 */
import { afterEach, describe, expect, test } from 'bun:test';
import React, { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { CommitListEntry } from '@plannotator/shared/types';
import type {
  ReviewNavigatorGrouping,
  ReviewNavigatorLayout,
} from '@plannotator/shared/review-navigator';
import { ReviewNavigator } from './ReviewNavigator';
import type { CommitFilesState } from './NavigatorCommitSection';
import type { NavigatorSelection } from '../utils/navigatorModel';
import type { DiffFile } from '../types';

const hasDom = typeof document !== 'undefined';
let host: HTMLDivElement | null = null;
let root: Root | null = null;

function file(path: string, additions = 1, deletions = 0): DiffFile {
  return {
    path,
    status: 'modified',
    additions,
    deletions,
    patch: '',
    hunks: [],
  } as unknown as DiffFile;
}

const FILES = [
  file('src/app.ts', 3, 1),
  file('src/lib/util.ts', 5, 2),
  file('README.md', 1, 0),
  file('notes.txt', 2, 0),
];

const SECTIONS = {
  base: 'origin/main',
  mergeBase: 'abc1234',
  files: {
    'src/app.ts': { group: 'changes' as const, staged: true },
    'src/lib/util.ts': { group: 'changes' as const, staged: false },
    'notes.txt': { group: 'untracked' as const, staged: false },
    // README.md deliberately has no entry: committed-only branch work, which
    // the Committed section's commit rows own.
  },
};

const COMMIT: CommitListEntry = {
  sha: 'f'.repeat(40),
  shortSha: 'fffffff',
  subject: 'feat: a commit subject long enough to wrap in a narrow panel',
  author: 'Navigator',
  authorEmail: 'nav@example.com',
  committedAt: Date.now() - 60_000,
  isHead: true,
  isPastBase: false,
  additions: 12,
  deletions: 4,
};

/** Already reachable from the base — shown below the divider, never counted. */
const SHARED_COMMIT: CommitListEntry = {
  ...COMMIT,
  sha: 'a'.repeat(40),
  shortSha: 'aaaaaaa',
  subject: 'chore: bump a dependency',
  isHead: false,
  isPastBase: true,
  additions: 500,
  deletions: 400,
};

const COMMIT_FILES: ReadonlyMap<string, CommitFilesState> = new Map([
  [
    COMMIT.sha,
    {
      status: 'ready' as const,
      files: [
        { path: 'README.md', status: 'modified' as const, additions: 12, deletions: 4, binary: false },
      ],
    },
  ],
]);

function Harness({
  initialLayout = 'flat',
  initialGrouping = 'status',
  groupingDisabledReason,
  groupingFallbackReason,
  onSelect,
  withCommits = true,
}: {
  initialLayout?: ReviewNavigatorLayout;
  initialGrouping?: ReviewNavigatorGrouping;
  groupingDisabledReason?: string;
  groupingFallbackReason?: string;
  onSelect?: (selection: NavigatorSelection) => void;
  withCommits?: boolean;
}) {
  const [layout, setLayout] = useState<ReviewNavigatorLayout>(initialLayout);
  const [grouping, setGrouping] = useState<ReviewNavigatorGrouping>(initialGrouping);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set([COMMIT.sha]));
  return (
    <ReviewNavigator
      files={FILES}
      sections={SECTIONS}
      layout={layout}
      grouping={grouping}
      onSelectLayout={setLayout}
      onSelectGrouping={setGrouping}
      groupingDisabledReason={groupingDisabledReason}
      groupingFallbackReason={groupingFallbackReason}
      activeSelection={null}
      onSelectFile={(selection) => onSelect?.(selection)}
      annotations={[]}
      viewedFiles={new Set()}
      stagedFiles={new Set(['src/app.ts'])}
      enableKeyboardNav={false}
      {...(withCommits
        ? {
            commits: [COMMIT, SHARED_COMMIT],
            commitsBase: 'origin/main',
            expandedCommits: expanded,
            onToggleCommit: (sha: string) =>
              setExpanded((prev) => {
                const next = new Set(prev);
                if (next.has(sha)) next.delete(sha);
                else next.add(sha);
                return next;
              }),
            commitFiles: COMMIT_FILES,
            onRetryCommitFiles: () => {},
          }
        : {})}
    />
  );
}

async function mount(element: React.ReactElement): Promise<HTMLElement> {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root!.render(element));
  return host;
}

function segment(container: HTMLElement, label: string): HTMLButtonElement {
  const found = [...container.querySelectorAll('[data-navigator-controls] button')].find(
    (b) => b.textContent?.trim() === label,
  );
  if (!found) throw new Error(`no segment labelled ${label}`);
  return found as HTMLButtonElement;
}

function fileRows(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll('.file-tree-item')] as HTMLElement[];
}

/** The `title` of every file row is its full path — a stable row identity. */
function rowPaths(container: HTMLElement): string[] {
  return fileRows(container).map((row) => row.getAttribute('title') ?? '');
}

function sectionHeaderLabels(container: HTMLElement): string[] {
  return [...container.querySelectorAll('button[aria-expanded]')]
    .map((b) => b.querySelector('span')?.textContent?.trim() ?? '')
    .filter((label) => ['Staged', 'Unstaged', 'Committed'].includes(label));
}

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
  host?.remove();
  host = null;
});

describe('ReviewNavigator layout x grouping', () => {
  test.skipIf(!hasDom)('all four combinations render the same changeset', async () => {
    // Failure caught: the retired three-way mode's dead corners coming back —
    // Flat + All and Tree + By Git status were unreachable before.
    const container = await mount(<Harness initialLayout="flat" initialGrouping="all" />);

    // Flat + All: every file of the active diff, one row each, no sections.
    expect(rowPaths(container).sort()).toEqual([
      'README.md',
      'notes.txt',
      'src/app.ts',
      'src/lib/util.ts',
    ]);
    expect(sectionHeaderLabels(container)).toEqual([]);

    // Tree + All: same files, now nested under directory rows.
    await act(async () => segment(container, 'Tree').click());
    expect(rowPaths(container).sort()).toEqual([
      'README.md',
      'notes.txt',
      'src/app.ts',
      'src/lib/util.ts',
    ]);
    // Directory rows only exist in the tree layout.
    const folderNames = [...container.querySelectorAll('button[aria-expanded]')]
      .map((b) => b.querySelector('span')?.textContent?.trim() ?? '')
      .filter((name) => name === 'src' || name === 'lib');
    expect(folderNames).toEqual(['src', 'lib']);

    // Tree + By Git status: sections appear, the layout choice is untouched.
    await act(async () => segment(container, 'By Git status').click());
    expect(sectionHeaderLabels(container)).toEqual(['Staged', 'Unstaged', 'Committed']);
    expect(segment(container, 'Tree').getAttribute('aria-pressed')).toBe('true');

    // Flat + By Git status: grouping survives the layout change.
    await act(async () => segment(container, 'Flat').click());
    expect(sectionHeaderLabels(container)).toEqual(['Staged', 'Unstaged', 'Committed']);
    expect(segment(container, 'By Git status').getAttribute('aria-pressed')).toBe('true');
  });

  test.skipIf(!hasDom)('untracked work lands under Unstaged, committed-only work under no section', async () => {
    const container = await mount(<Harness initialLayout="flat" initialGrouping="status" />);
    const paths = rowPaths(container);
    // src/app.ts is staged, src/lib/util.ts and notes.txt are working-tree
    // changes, README.md is committed-only and belongs to the commit row.
    expect(paths).toContain('src/app.ts');
    expect(paths).toContain('notes.txt');
    // README.md appears once, inside the expanded commit — not as a
    // working-scope row.
    expect(paths.filter((p) => p === 'README.md')).toHaveLength(1);
    expect(container.textContent).toContain(COMMIT.subject);
  });
});

describe('commit rows', () => {
  test.skipIf(!hasDom)('a file inside a commit selects that commit scope, not the working one', async () => {
    // Failure caught: the two entries for one path collapsing into a single
    // selection, which would show the branch diff where the reviewer asked for
    // this commit's version of the file.
    const seen: NavigatorSelection[] = [];
    const container = await mount(<Harness onSelect={(s) => seen.push(s)} />);

    const readmeRow = fileRows(container).find((r) => r.getAttribute('title') === 'README.md');
    expect(readmeRow).toBeTruthy();
    await act(async () => readmeRow!.click());

    expect(seen).toHaveLength(1);
    expect(seen[0]).toEqual({ scope: { kind: 'commit', sha: COMMIT.sha }, path: 'README.md' });

    // A working-scope row from the same panel carries the other scope.
    const appRow = fileRows(container).find((r) => r.getAttribute('title') === 'src/app.ts');
    await act(async () => appRow!.click());
    expect(seen[1]).toEqual({ scope: { kind: 'working' }, path: 'src/app.ts' });
  });

  test.skipIf(!hasDom)('the Committed total counts branch work, not shared history below the divider', async () => {
    // Failure caught: "Show more" paging into the base's history and the
    // section header suddenly claiming the whole repository's churn.
    const container = await mount(<Harness />);
    const header = [...container.querySelectorAll('button[aria-expanded]')].find(
      (b) => b.querySelector('span')?.textContent?.trim() === 'Committed',
    )!;
    expect(header.textContent).toContain('+12');
    expect(header.textContent).toContain('-4');
    expect(header.textContent).not.toContain('500');
    // The shared commit is still listed, under the boundary.
    expect(container.textContent).toContain(SHARED_COMMIT.subject);
    expect(container.textContent).toContain('In origin/main');
  });

  test.skipIf(!hasDom)('collapsing a commit hides its files without touching the sections', async () => {
    const container = await mount(<Harness />);
    const commitRow = container.querySelector(`[data-commit-row="${COMMIT.sha}"]`) as HTMLElement;
    expect(commitRow.getAttribute('aria-expanded')).toBe('true');
    await act(async () => commitRow.click());
    expect(rowPaths(container)).not.toContain('README.md');
    expect(sectionHeaderLabels(container)).toEqual(['Staged', 'Unstaged', 'Committed']);
  });
});

describe('sessions that cannot group by Git status', () => {
  test.skipIf(!hasDom)('disables the segment with the reason and renders one combined list', async () => {
    // Failure caught: three empty section headers with no explanation in a PR,
    // workspace or jj review.
    const reason = 'Grouping by Git status needs a local working tree.';
    const container = await mount(
      <Harness
        initialGrouping="all"
        groupingDisabledReason={reason}
        withCommits={false}
      />,
    );
    const statusSegment = segment(container, 'By Git status');
    expect(statusSegment.hasAttribute('disabled')).toBe(true);
    expect(statusSegment.getAttribute('title')).toBe(reason);
    expect(sectionHeaderLabels(container)).toEqual([]);
  });

  test.skipIf(!hasDom)('a diff with no partition states why the sections are absent', async () => {
    const reason = 'Showing all changes: Git status grouping needs the All changes diff.';
    const container = await mount(
      <Harness initialGrouping="all" groupingFallbackReason={reason} withCommits={false} />,
    );
    expect(container.textContent).toContain(reason);
  });
});
