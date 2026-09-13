import type { ReviewNavigatorGrouping } from '@plannotator/shared/review-navigator';
import type { SinceBaseSections } from '@plannotator/shared/types';
import type { DiffFile } from '../types';

/**
 * Pure model behind the unified review navigator.
 *
 * Two things live here: the (scope, path) identity a navigator selection
 * carries, and the grouping of a working-tree file set into the Staged /
 * Unstaged sections. The layout half (flat vs tree) is
 * `buildNavigatorTree` — it operates on the same minimal row shape so a
 * commit's files and the working set go through one code path.
 */

/**
 * Which diff a navigator row belongs to.
 *
 * `working` is the session's ordinary diff (whatever the base-reference and
 * diff-type pickers select); `commit` is one historical commit vs its first
 * parent. The same path legitimately appears in both — a file with committed
 * AND uncommitted work is one row under Unstaged with its working-tree delta
 * and another inside each commit that touched it with that commit's delta.
 * Selection, highlight and viewed state therefore key on the PAIR, never on
 * the path alone.
 */
export type NavigatorScope = { kind: 'working' } | { kind: 'commit'; sha: string };

export interface NavigatorSelection {
  scope: NavigatorScope;
  path: string;
}

/** The minimum a navigator row needs; satisfied by both DiffFile and CommitFileEntry. */
export interface NavigatorRow {
  path: string;
  oldPath?: string;
  status: 'added' | 'deleted' | 'modified' | 'renamed';
  additions: number;
  deletions: number;
}

export interface NavigatorFileItem<R extends NavigatorRow = NavigatorRow> {
  row: R;
  /** True for a file git reports as untracked — keeps the `U` letter visible
   * even though untracked files now live inside Unstaged. */
  untracked: boolean;
  staged: boolean;
}

export interface NavigatorStatusGroups<R extends NavigatorRow = NavigatorRow> {
  staged: NavigatorFileItem<R>[];
  unstaged: NavigatorFileItem<R>[];
}

export interface DiffTotals {
  additions: number;
  deletions: number;
}

export function sumTotals(rows: readonly NavigatorRow[]): DiffTotals {
  let additions = 0;
  let deletions = 0;
  for (const row of rows) {
    additions += row.additions;
    deletions += row.deletions;
  }
  return { additions, deletions };
}

/**
 * Split a working-tree file set into the Staged and Unstaged sections.
 *
 * Untracked files fold into Unstaged (they are working-tree changes that are
 * not in the index) and keep `untracked: true` so the status letter still says
 * `U`. Files whose sidecar entry says `committed` — clean in the working tree,
 * changed only by commits in the review range — belong to the Committed
 * section's commit rows and appear in neither list.
 *
 * `stagedFiles` MUST be useGitAdd's effective set (sidecar snapshot + this
 * session's stage/unstage overrides); the sidecar's own `staged` flag is a
 * snapshot and is read here only to decide whether an unstaged ADD falls back
 * to untracked.
 */
export function buildNavigatorStatusGroups<R extends NavigatorRow>(
  files: readonly R[],
  sections: SinceBaseSections | null | undefined,
  stagedFiles: ReadonlySet<string>,
): NavigatorStatusGroups<R> {
  const staged: NavigatorFileItem<R>[] = [];
  const unstaged: NavigatorFileItem<R>[] = [];
  for (const row of files) {
    const entry = sections?.files[row.path];
    // No sidecar entry means a clean working tree for a file the patch covers:
    // committed branch work, which the Committed section owns.
    let group = entry?.group ?? 'committed';
    const isStaged = stagedFiles.has(row.path);
    // Staging an untracked file makes it tracked+staged in git while the
    // sidecar snapshot still says untracked — anticipate the server.
    if (group === 'untracked' && isStaged) group = 'changes';
    // Mirror image: a file that was already staged when the snapshot was taken
    // and is an ADD becomes untracked again when this session unstages it.
    else if (group === 'changes' && (entry?.staged ?? false) && !isStaged && row.status === 'added') {
      group = 'untracked';
    }
    if (group === 'committed') continue;
    const item: NavigatorFileItem<R> = { row, untracked: group === 'untracked', staged: isStaged };
    (isStaged ? staged : unstaged).push(item);
  }
  return { staged, unstaged };
}

// --- Layout: flat vs tree ----------------------------------------------------

export interface NavigatorTreeFile<R extends NavigatorRow = NavigatorRow> {
  type: 'file';
  name: string;
  path: string;
  depth: number;
  item: NavigatorFileItem<R>;
  additions: number;
  deletions: number;
}

export interface NavigatorTreeFolder<R extends NavigatorRow = NavigatorRow> {
  type: 'folder';
  name: string;
  path: string;
  depth: number;
  children: NavigatorTreeNode<R>[];
  additions: number;
  deletions: number;
  /**
   * The proposal suppresses a directory's totals when they would only restate
   * its single child's — true when this folder holds exactly one file and
   * nothing else.
   */
  redundantTotals: boolean;
}

export type NavigatorTreeNode<R extends NavigatorRow = NavigatorRow> =
  | NavigatorTreeFile<R>
  | NavigatorTreeFolder<R>;

interface TrieNode<R extends NavigatorRow> {
  children: Map<string, TrieNode<R>>;
  item?: NavigatorFileItem<R>;
}

/**
 * Directory hierarchy over navigator items: folders first then files, both
 * alphabetical, and single-child FOLDER chains merged into one `a/b` row —
 * the same shape the review's file tree has always had, generalised off
 * `DiffFile`/`fileIndex` so a commit's files build the same way.
 */
export function buildNavigatorTree<R extends NavigatorRow>(
  items: readonly NavigatorFileItem<R>[],
): NavigatorTreeNode<R>[] {
  if (items.length === 0) return [];
  const root: TrieNode<R> = { children: new Map() };
  for (const item of items) {
    const segments = item.row.path.split('/').filter(Boolean);
    let current = root;
    for (let i = 0; i < segments.length - 1; i++) {
      let next = current.children.get(segments[i]);
      if (!next) {
        next = { children: new Map() };
        current.children.set(segments[i], next);
      }
      current = next;
    }
    const leaf = segments[segments.length - 1] ?? item.row.path;
    current.children.set(leaf, { children: new Map(), item });
  }

  const toNodes = (node: TrieNode<R>, parentPath: string, depth: number): NavigatorTreeNode<R>[] => {
    const folders: NavigatorTreeFolder<R>[] = [];
    const files: NavigatorTreeFile<R>[] = [];
    for (const [name, child] of node.children) {
      const fullPath = parentPath ? `${parentPath}/${name}` : name;
      if (child.item) {
        files.push({
          type: 'file',
          name,
          path: child.item.row.path,
          depth,
          item: child.item,
          additions: child.item.row.additions,
          deletions: child.item.row.deletions,
        });
      } else {
        const children = toNodes(child, fullPath, depth + 1);
        const totals = children.reduce(
          (acc, c) => ({ additions: acc.additions + c.additions, deletions: acc.deletions + c.deletions }),
          { additions: 0, deletions: 0 },
        );
        folders.push({
          type: 'folder',
          name,
          path: fullPath,
          depth,
          children,
          ...totals,
          redundantTotals: children.length === 1 && children[0].type === 'file',
        });
      }
    }
    folders.sort((a, b) => a.name.localeCompare(b.name));
    files.sort((a, b) => a.name.localeCompare(b.name));
    return [...folders, ...files];
  };

  const fixDepths = (nodes: NavigatorTreeNode<R>[], depth: number): NavigatorTreeNode<R>[] =>
    nodes.map((node) =>
      node.type === 'folder'
        ? { ...node, depth, children: fixDepths(node.children, depth + 1) }
        : { ...node, depth },
    );

  const collapseChains = (nodes: NavigatorTreeNode<R>[]): NavigatorTreeNode<R>[] =>
    nodes.map((node) => {
      if (node.type !== 'folder') return node;
      let current = node;
      while (current.children.length === 1 && current.children[0].type === 'folder') {
        const only = current.children[0] as NavigatorTreeFolder<R>;
        current = { ...only, name: `${current.name}/${only.name}`, depth: node.depth };
      }
      return { ...current, children: collapseChains(fixDepths(current.children, node.depth + 1)) };
    });

  return collapseChains(toNodes(root, '', 0));
}

/**
 * Depth-first render order of a tree's files — what j/k walks.
 *
 * Folders are expanded unless explicitly collapsed (a folder the reviewer has
 * never touched is open), so this takes the COLLAPSED set: a brand-new
 * directory arriving in a refreshed diff is visible without any seeding pass.
 */
export function navigatorTreeFileOrder<R extends NavigatorRow>(
  nodes: readonly NavigatorTreeNode<R>[],
  collapsedFolders: ReadonlySet<string>,
  folderKey: (path: string) => string,
): NavigatorFileItem<R>[] {
  const order: NavigatorFileItem<R>[] = [];
  for (const node of nodes) {
    if (node.type === 'file') order.push(node.item);
    else if (!collapsedFolders.has(folderKey(node.path))) {
      order.push(...navigatorTreeFileOrder(node.children, collapsedFolders, folderKey));
    }
  }
  return order;
}

/** Every folder key in a tree, for expand/collapse-all. */
export function navigatorFolderKeys<R extends NavigatorRow>(
  nodes: readonly NavigatorTreeNode<R>[],
  folderKey: (path: string) => string,
): string[] {
  const keys: string[] = [];
  for (const node of nodes) {
    if (node.type === 'folder') {
      keys.push(folderKey(node.path));
      keys.push(...navigatorFolderKeys(node.children, folderKey));
    }
  }
  return keys;
}

/** Directory shown as secondary text beside a filename in the flat layout. */
export function flatRowDirectory(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash === -1 ? '' : path.slice(0, slash);
}

export function flatRowName(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash === -1 ? path : path.slice(slash + 1);
}

// --- Grouping availability ---------------------------------------------------

export interface GroupingCapability {
  /** Whether "By Git status" can be offered at all in this session. */
  available: boolean;
  /** Why not, for the control's title. Empty when available. */
  reason: string;
}

/**
 * Whether this SESSION can group by git status.
 *
 * Sections are a git-index concept: a pull-request review has no index and no
 * working tree, a multi-repo workspace has no single index, and jj / GitButler
 * / Perforce do not expose one the review server reads. Those sessions get the
 * control disabled with a reason rather than three empty section headers.
 */
export function resolveGroupingCapability(session: {
  isPR: boolean;
  isWorkspace: boolean;
  vcsType?: string;
}): GroupingCapability {
  if (session.isPR) {
    return { available: false, reason: 'Grouping by Git status needs a local working tree — a pull request review has none.' };
  }
  if (session.isWorkspace) {
    return { available: false, reason: 'Grouping by Git status is unavailable in a multi-repo workspace review — each repository has its own index.' };
  }
  if (session.vcsType && session.vcsType !== 'git') {
    return { available: false, reason: `Grouping by Git status needs a plain Git repository (this review is ${session.vcsType}).` };
  }
  return { available: true, reason: '' };
}

/**
 * The grouping actually RENDERED, plus why it differs from the selection.
 *
 * A session that cannot group at all renders All. So does a diff with no
 * git-status partition — the sidecar exists only for the composite
 * `since-base` view, and a classic diff (staged-only, a single commit, HEAD)
 * has nothing to partition. Degrading in the render, with the reason on
 * screen, is deliberate: the selection survives, so returning to a
 * partitionable diff restores the sections without the reviewer re-picking.
 */
export function resolveEffectiveGrouping(params: {
  selected: ReviewNavigatorGrouping;
  capability: GroupingCapability;
  /** Working-set sections are loaded and describe the session's working diff. */
  hasSections: boolean;
}): { grouping: ReviewNavigatorGrouping; fallbackReason: string } {
  if (params.selected !== 'status') return { grouping: params.selected, fallbackReason: '' };
  if (!params.capability.available) return { grouping: 'all', fallbackReason: params.capability.reason };
  if (!params.hasSections) {
    return {
      grouping: 'all',
      fallbackReason: 'Showing all changes: Git status grouping needs the All changes (since base) diff.',
    };
  }
  return { grouping: 'status', fallbackReason: '' };
}
