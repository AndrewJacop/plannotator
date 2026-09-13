import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CodeAnnotation } from '@plannotator/ui/types';
import type {
  ReviewNavigatorGrouping,
  ReviewNavigatorLayout,
} from '@plannotator/shared/review-navigator';
import type {
  AvailableBranches,
  CommitListEntry,
  CompareTargetConfig,
  DiffOption,
  JjEvoLogEntry,
  RecentCommit,
  SinceBaseSections,
  WorktreeInfo,
} from '@plannotator/shared/types';
import { BaseBranchPicker } from './BaseBranchPicker';
import { EvoLogPicker } from './EvoLogPicker';
import { DiffTypePicker } from './DiffTypePicker';
import { WorktreePicker } from './WorktreePicker';
import { NavigatorControls } from './NavigatorControls';
import { NavigatorCollection, navigatorFolderKey, type NavigatorRowState } from './NavigatorCollection';
import { NavigatorCommitSection, type CommitFilesState } from './NavigatorCommitSection';
import { SearchFileGroup } from './SearchResults';
import type { ReviewSearchFileGroup, ReviewSearchMatch } from '../utils/reviewSearch';
import type { DiffFile } from '../types';
import { OverlayScrollArea } from '@plannotator/ui/components/OverlayScrollArea';
import { GitHubIcon } from '@plannotator/ui/components/GitHubIcon';
import { Paperclip } from 'lucide-react';
import { SidebarActionRow, SemanticDiffRow, CallFlowRow, AllFilesRow } from './PanelNavRows';
import { PanelControlsRow, PanelSearchField } from './PanelChrome';
import { DiffCounts } from './FileRowBits';
import {
  buildNavigatorStatusGroups,
  buildNavigatorTree,
  navigatorFolderKeys,
  navigatorTreeFileOrder,
  sumTotals,
  type NavigatorFileItem,
  type NavigatorSelection,
} from '../utils/navigatorModel';

/**
 * The unified review navigator — the review's single left panel (issue #1524).
 *
 * It replaced three competing modes (Tree, Git status, Commits) with one
 * surface carrying two INDEPENDENT segmented controls: File layout
 * (Flat / Tree) and Grouping (All / By Git status). All four combinations
 * render, and changing one never changes the other.
 *
 * A navigator selection carries a SCOPE as well as a path. Picking a file
 * under Staged / Unstaged / All reviews the session's working diff; picking a
 * file inside an expanded commit row reviews `commit:<sha>` vs its first
 * parent, scoped to that file. There is no mode to enter or leave — the
 * selection is what drives the centre diff.
 */

/** Panel width below which the two control groups stack instead of sharing a row. */
const CONTROLS_STACK_WIDTH = 260;

const WORKING_PREFIX = 'w:';
const ALL_PREFIX = 'a:';

interface ReviewNavigatorProps {
  /** Files of the ACTIVE diff — what the All grouping lists. */
  files: DiffFile[];
  /**
   * Files of the session's working diff. Differs from `files` only while a
   * commit diff is on screen, which is exactly when the Staged / Unstaged
   * sections still have to describe the working tree.
   */
  workingFiles?: DiffFile[];
  /** Git-status sidecar for `workingFiles`. Null disables status grouping. */
  sections?: SinceBaseSections | null;
  layout: ReviewNavigatorLayout;
  grouping: ReviewNavigatorGrouping;
  onSelectLayout: (layout: ReviewNavigatorLayout) => void;
  onSelectGrouping: (grouping: ReviewNavigatorGrouping) => void;
  /** Set when this session can never group by git status; disables the segment. */
  groupingDisabledReason?: string;
  /** Set when the SELECTION is status but this diff can't honour it. */
  groupingFallbackReason?: string;

  /** Path highlighted in the navigator, with the scope it belongs to. */
  activeSelection: NavigatorSelection | null;
  /** File currently visible while scrolling the all-files surface (soft highlight). */
  scrollHighlightPath?: string | null;
  onSelectFile: (selection: NavigatorSelection) => void;
  onDoubleClickFile?: (selection: NavigatorSelection) => void;

  annotations: CodeAnnotation[];
  viewedFiles: Set<string>;
  onToggleViewed?: (filePath: string) => void;
  /** Viewed state for files inside a commit — keyed on (sha, path). */
  isViewedInCommit?: (sha: string, filePath: string) => boolean;
  onToggleViewedInCommit?: (sha: string, filePath: string) => void;
  hideViewedFiles?: boolean;
  onToggleHideViewed?: () => void;
  showViewedControls?: boolean;
  onToggleShowViewedControls?: () => void;
  enableKeyboardNav?: boolean;

  diffOptions?: DiffOption[];
  activeDiffType?: string;
  onSelectDiff?: (diffType: string) => void;
  isLoadingDiff?: boolean;
  width?: number;
  worktrees?: WorktreeInfo[];
  activeWorktreePath?: string | null;
  onSelectWorktree?: (path: string | null) => void;
  currentBranch?: string;
  availableBranches?: AvailableBranches;
  selectedBase?: string;
  detectedBase?: string;
  onSelectBase?: (branch: string) => void;
  compareTarget?: CompareTargetConfig;
  recentCommits?: RecentCommit[];
  jjEvologs?: JjEvoLogEntry[];
  detectedEvoBase?: string;

  /** EFFECTIVE staged set from useGitAdd (sidecar + session overrides).
   *  REQUIRED and the ONLY staging source surfaces may render from — the
   *  sidecar's own `staged` flag is a snapshot and must never be ORed in. */
  stagedFiles: Set<string>;
  stagingFile?: string | null;
  canStage?: boolean;
  onStageFile?: (filePath: string) => void;
  showStageControls?: boolean;
  onToggleShowStageControls?: () => void;
  autoViewed?: boolean;
  onToggleAutoViewed?: () => void;

  onCopyRawDiff?: () => void;
  canCopyRawDiff?: boolean;
  copyRawDiffStatus?: 'idle' | 'success' | 'error';

  searchQuery?: string;
  isSearchOpen?: boolean;
  isSearchPending?: boolean;
  searchInputRef?: React.RefObject<HTMLInputElement | null>;
  onOpenSearch?: () => void;
  onSearchChange?: (value: string) => void;
  onSearchClear?: () => void;
  onSearchClose?: () => void;
  searchGroups?: ReviewSearchFileGroup[];
  searchMatches?: ReviewSearchMatch[];
  activeSearchMatchId?: string | null;
  onSelectSearchMatch?: (matchId: string) => void;
  onStepSearchMatch?: (direction: 1 | -1) => void;

  onSelectPROverview?: () => void;
  isPROverviewActive?: boolean;
  prOverviewNumber?: string;
  prOverviewTitle?: string;
  onSelectPRArtifacts?: () => void;
  isPRArtifactsActive?: boolean;
  prArtifactCount?: number;
  onSelectSemanticDiff?: () => void;
  isSemanticDiffActive?: boolean;
  semanticDiffAvailable?: boolean;
  onSelectCallFlow?: () => void;
  isCallFlowActive?: boolean;
  callFlowEnabled?: boolean;
  callFlowCount?: number;
  callFlowLoading?: boolean;
  callFlowError?: boolean;
  onSelectAllFiles?: () => void;
  isAllFilesActive?: boolean;
  repoRoot?: string | null;

  /** Committed section — omitted entirely when the session has no commit history. */
  commits?: CommitListEntry[];
  commitsBase?: string | null;
  commitsHasMore?: boolean;
  commitsLoading?: boolean;
  commitsLoadingMore?: boolean;
  commitsError?: string | null;
  onShowMoreCommits?: () => void;
  onRetryCommits?: () => void;
  expandedCommits?: ReadonlySet<string>;
  onToggleCommit?: (sha: string) => void;
  commitFiles?: ReadonlyMap<string, CommitFilesState>;
  onRetryCommitFiles?: (sha: string) => void;
}

type SectionId = 'staged' | 'unstaged' | 'committed';

const SectionHeader: React.FC<{
  label: string;
  collapsed: boolean;
  onToggle: () => void;
  additions: number;
  deletions: number;
  title?: string;
}> = ({ label, collapsed, onToggle, additions, deletions, title }) => (
  <button
    onClick={onToggle}
    aria-expanded={!collapsed}
    title={title}
    className="w-full flex items-center gap-1.5 px-2 py-1.5 text-muted-foreground hover:text-foreground transition-colors"
  >
    <svg
      className={`w-2.5 h-2.5 flex-shrink-0 transition-transform ${collapsed ? '-rotate-90' : ''}`}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
    </svg>
    <span className="text-[11px] font-medium">{label}</span>
    <span className="ml-auto">
      <DiffCounts additions={additions} deletions={deletions} />
    </span>
  </button>
);

export const ReviewNavigator: React.FC<ReviewNavigatorProps> = ({
  files,
  workingFiles,
  sections,
  layout,
  grouping,
  onSelectLayout,
  onSelectGrouping,
  groupingDisabledReason,
  groupingFallbackReason,
  activeSelection,
  scrollHighlightPath,
  onSelectFile,
  onDoubleClickFile,
  annotations,
  viewedFiles,
  onToggleViewed,
  isViewedInCommit,
  onToggleViewedInCommit,
  hideViewedFiles = false,
  onToggleHideViewed,
  showViewedControls = true,
  onToggleShowViewedControls,
  enableKeyboardNav = true,
  diffOptions,
  activeDiffType,
  onSelectDiff,
  isLoadingDiff,
  width,
  worktrees,
  activeWorktreePath,
  onSelectWorktree,
  currentBranch,
  availableBranches,
  selectedBase,
  detectedBase,
  onSelectBase,
  compareTarget,
  recentCommits,
  jjEvologs,
  detectedEvoBase,
  stagedFiles,
  stagingFile,
  canStage = false,
  onStageFile,
  showStageControls = true,
  onToggleShowStageControls,
  autoViewed,
  onToggleAutoViewed,
  onCopyRawDiff,
  canCopyRawDiff = false,
  copyRawDiffStatus = 'idle',
  searchQuery = '',
  isSearchOpen = false,
  isSearchPending,
  searchInputRef,
  onOpenSearch,
  onSearchChange,
  onSearchClear,
  onSearchClose,
  searchGroups = [],
  searchMatches = [],
  activeSearchMatchId,
  onSelectSearchMatch,
  onStepSearchMatch,
  onSelectPROverview,
  isPROverviewActive = false,
  prOverviewNumber,
  prOverviewTitle,
  onSelectPRArtifacts,
  isPRArtifactsActive = false,
  prArtifactCount,
  onSelectSemanticDiff,
  isSemanticDiffActive = false,
  semanticDiffAvailable = false,
  onSelectCallFlow,
  isCallFlowActive = false,
  callFlowEnabled = false,
  callFlowCount,
  callFlowLoading,
  callFlowError,
  onSelectAllFiles,
  isAllFilesActive = false,
  repoRoot,
  commits = [],
  commitsBase = null,
  commitsHasMore = false,
  commitsLoading = false,
  commitsLoadingMore = false,
  commitsError = null,
  onShowMoreCommits,
  onRetryCommits,
  expandedCommits,
  onToggleCommit,
  commitFiles,
  onRetryCommitFiles,
}) => {
  const isSearchVisible = !!onSearchChange && (isSearchOpen || !!searchQuery.trim());
  const panelWidth = width ?? 256;

  // Folders are expanded unless explicitly collapsed, so a diff refresh that
  // introduces a new directory shows it without any re-seeding pass (the old
  // tree re-expanded everything on every tree identity change, which silently
  // undid the reviewer's collapses).
  const [collapsedFolders, setCollapsedFolders] = useState<ReadonlySet<string>>(() => new Set());
  const [collapsedSections, setCollapsedSections] = useState<ReadonlySet<SectionId>>(() => new Set());

  const toggleFolder = useCallback((key: string) => {
    setCollapsedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const toggleSection = useCallback((id: SectionId) => {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const annotationCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const a of annotations) counts.set(a.filePath, (counts.get(a.filePath) ?? 0) + 1);
    return counts;
  }, [annotations]);
  const annotationCount = useCallback(
    (path: string) => annotationCounts.get(path) ?? 0,
    [annotationCounts],
  );

  const activePath = activeSelection?.path ?? null;
  const activeScopeSha =
    activeSelection?.scope.kind === 'commit' ? activeSelection.scope.sha : null;

  // --- Collections ----------------------------------------------------------

  const workingSet = workingFiles ?? files;
  const statusGroups = useMemo(
    () => buildNavigatorStatusGroups(workingSet, sections, stagedFiles),
    [workingSet, sections, stagedFiles],
  );

  const hideViewed = useCallback(
    (items: NavigatorFileItem<DiffFile>[]) =>
      hideViewedFiles
        ? items.filter((item) => !viewedFiles.has(item.row.path) || item.row.path === activePath)
        : items,
    [hideViewedFiles, viewedFiles, activePath],
  );

  const allItems = useMemo<NavigatorFileItem<DiffFile>[]>(() => {
    const items = files.map((file) => {
      const entry = sections?.files[file.path];
      return {
        row: file,
        untracked: entry?.group === 'untracked' && !stagedFiles.has(file.path),
        staged: stagedFiles.has(file.path),
      };
    });
    return hideViewed(items);
  }, [files, sections, stagedFiles, hideViewed]);

  const stagedItems = useMemo(() => hideViewed(statusGroups.staged), [statusGroups, hideViewed]);
  const unstagedItems = useMemo(() => hideViewed(statusGroups.unstaged), [statusGroups, hideViewed]);

  const showCommitted = !!onToggleCommit && !!commitFiles && !!expandedCommits;
  const effectiveGrouping = grouping;

  // --- Keyboard nav order ---------------------------------------------------
  //
  // j/k/Home/End walk every file row on screen in render order, including the
  // ones inside expanded commit rows — which is why the order carries
  // selections, not indices: the two scopes address different diffs.
  const orderFor = useCallback(
    (items: NavigatorFileItem<{ path: string; oldPath?: string; status: DiffFile['status']; additions: number; deletions: number }>[], keyPrefix: string) =>
      layout === 'tree'
        ? navigatorTreeFileOrder(buildNavigatorTree(items), collapsedFolders, (p) =>
            navigatorFolderKey(keyPrefix, p),
          )
        : items,
    [layout, collapsedFolders],
  );

  const navOrder = useMemo<NavigatorSelection[]>(() => {
    const order: NavigatorSelection[] = [];
    if (effectiveGrouping === 'all') {
      for (const item of orderFor(allItems, ALL_PREFIX)) {
        order.push({ scope: { kind: 'working' }, path: item.row.path });
      }
      return order;
    }
    if (!collapsedSections.has('staged')) {
      for (const item of orderFor(stagedItems, `${WORKING_PREFIX}staged:`)) {
        order.push({ scope: { kind: 'working' }, path: item.row.path });
      }
    }
    if (!collapsedSections.has('unstaged')) {
      for (const item of orderFor(unstagedItems, `${WORKING_PREFIX}unstaged:`)) {
        order.push({ scope: { kind: 'working' }, path: item.row.path });
      }
    }
    if (showCommitted && !collapsedSections.has('committed')) {
      for (const commit of commits) {
        if (!expandedCommits?.has(commit.sha)) continue;
        const state = commitFiles?.get(commit.sha);
        if (state?.status !== 'ready') continue;
        const items = (state.files ?? []).map((file) => ({ row: file, untracked: false, staged: false }));
        for (const item of orderFor(items, `${commit.sha}:`)) {
          order.push({ scope: { kind: 'commit', sha: commit.sha }, path: item.row.path });
        }
      }
    }
    return order;
  }, [
    effectiveGrouping,
    orderFor,
    allItems,
    stagedItems,
    unstagedItems,
    collapsedSections,
    showCommitted,
    commits,
    expandedCommits,
    commitFiles,
  ]);

  useEffect(() => {
    if (enableKeyboardNav === false) return;
    const handler = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if (searchQuery.trim()) return; // search results own the panel
      // composedPath()[0] pierces shadow DOM: a window-level e.target retargets
      // to the shadow HOST, so keystrokes inside the Pierre editor's
      // contenteditable would otherwise read as non-editable and switch files
      // mid-edit.
      const origin = (e.composedPath?.()[0] ?? e.target) as HTMLElement | null;
      if (origin && (origin.tagName === 'INPUT' || origin.tagName === 'TEXTAREA' || origin.isContentEditable)) return;
      const active = document.activeElement;
      if (active instanceof HTMLElement && active.closest('[role="menu"], [role="dialog"], [role="listbox"]')) return;
      if (navOrder.length === 0) return;
      const navKey = ['j', 'k', 'ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key);
      if (!navKey) return;
      // Clear focus from a previously-clicked row so its focus ring doesn't
      // linger on the wrong file while keyboard nav moves the highlight.
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      const pos = navOrder.findIndex(
        (sel) =>
          sel.path === activePath &&
          (sel.scope.kind === 'commit' ? sel.scope.sha : null) === activeScopeSha,
      );
      e.preventDefault();
      if (e.key === 'j' || e.key === 'ArrowDown') {
        onSelectFile(navOrder[pos < navOrder.length - 1 ? pos + 1 : pos === -1 ? 0 : pos]);
      } else if (e.key === 'k' || e.key === 'ArrowUp') {
        onSelectFile(navOrder[pos > 0 ? pos - 1 : 0]);
      } else if (e.key === 'Home') {
        onSelectFile(navOrder[0]);
      } else {
        onSelectFile(navOrder[navOrder.length - 1]);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [enableKeyboardNav, navOrder, activePath, activeScopeSha, onSelectFile, searchQuery]);

  // --- Expand / collapse all ------------------------------------------------

  const allFolderKeys = useMemo(() => {
    if (layout !== 'tree') return [];
    const keys: string[] = [];
    const add = (items: NavigatorFileItem<any>[], prefix: string) => {
      keys.push(...navigatorFolderKeys(buildNavigatorTree(items), (p) => navigatorFolderKey(prefix, p)));
    };
    if (effectiveGrouping === 'all') add(allItems, ALL_PREFIX);
    else {
      add(stagedItems, `${WORKING_PREFIX}staged:`);
      add(unstagedItems, `${WORKING_PREFIX}unstaged:`);
      if (showCommitted) {
        for (const commit of commits) {
          const state = commitFiles?.get(commit.sha);
          if (state?.status !== 'ready') continue;
          add(
            (state.files ?? []).map((file) => ({ row: file, untracked: false, staged: false })),
            `${commit.sha}:`,
          );
        }
      }
    }
    return keys;
  }, [layout, effectiveGrouping, allItems, stagedItems, unstagedItems, showCommitted, commits, commitFiles]);

  const areAllFoldersExpanded =
    allFolderKeys.length > 0 && allFolderKeys.every((key) => !collapsedFolders.has(key));
  const handleToggleAllFolders = useCallback(() => {
    setCollapsedFolders(areAllFoldersExpanded ? new Set(allFolderKeys) : new Set());
  }, [areAllFoldersExpanded, allFolderKeys]);

  // --- Row state ------------------------------------------------------------

  const workingRowState = useCallback(
    (item: NavigatorFileItem<DiffFile>, committed: boolean): NavigatorRowState => {
      const stageable = canStage && !!onStageFile && !committed;
      return {
        // A working-scope row is only the active one while the working diff is
        // what the centre shows — selecting the same path inside a commit row
        // must not light both.
        isActive: activeScopeSha === null && item.row.path === activePath && !isAllFilesActive,
        isScrollActive:
          activeScopeSha === null &&
          isAllFilesActive &&
          !!scrollHighlightPath &&
          item.row.path === scrollHighlightPath,
        isViewed: viewedFiles.has(item.row.path),
        annotationCount: annotationCount(item.row.path),
        stageSlot: committed ? 'committed' : stageable || item.staged ? 'stage' : 'spacer',
        isStaging: stagingFile === item.row.path,
      };
    },
    [
      canStage,
      onStageFile,
      activeScopeSha,
      activePath,
      isAllFilesActive,
      scrollHighlightPath,
      viewedFiles,
      annotationCount,
      stagingFile,
    ],
  );

  const selectWorking = useCallback(
    (item: NavigatorFileItem<DiffFile>) => onSelectFile({ scope: { kind: 'working' }, path: item.row.path }),
    [onSelectFile],
  );
  const doubleClickWorking = useCallback(
    (item: NavigatorFileItem<DiffFile>) =>
      onDoubleClickFile?.({ scope: { kind: 'working' }, path: item.row.path }),
    [onDoubleClickFile],
  );

  const collectionCommonProps = {
    layout,
    collapsedFolders,
    onToggleFolder: toggleFolder,
    showViewedControls,
    showStageControls,
    onSelect: selectWorking,
    onDoubleClick: onDoubleClickFile ? doubleClickWorking : undefined,
    onToggleViewed: onToggleViewed
      ? (item: NavigatorFileItem<DiffFile>) => onToggleViewed(item.row.path)
      : undefined,
    onStage: onStageFile ? (item: NavigatorFileItem<DiffFile>) => onStageFile(item.row.path) : undefined,
    repoRoot,
  };

  // --- Totals ---------------------------------------------------------------

  const allTotals = sumTotals(files);
  const stagedTotals = sumTotals(stagedItems.map((i) => i.row));
  const unstagedTotals = sumTotals(unstagedItems.map((i) => i.row));
  // Only the branch-local commits count towards the section total: "Show more"
  // pages into shared history below the `In <base>` boundary, and folding
  // those in would make the header claim the whole repository's churn.
  const committedTotals = commits.reduce(
    (acc, c) =>
      c.isPastBase
        ? acc
        : { additions: acc.additions + c.additions, deletions: acc.deletions + c.deletions },
    { additions: 0, deletions: 0 },
  );

  const searchField = isSearchVisible ? (
    <PanelSearchField
      inputRef={searchInputRef}
      query={searchQuery}
      resultCount={searchMatches.length}
      isPending={!!isSearchPending}
      onChange={(value) => onSearchChange?.(value)}
      onKeyDown={(event) => {
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f') {
          event.preventDefault();
          return;
        }
        if (event.key === 'Enter' && searchMatches.length > 0 && !isSearchPending) {
          event.preventDefault();
          onStepSearchMatch?.(event.shiftKey ? -1 : 1);
        }
        if (event.key === 'Escape') {
          event.preventDefault();
          if (searchQuery) {
            onSearchClear?.();
          } else {
            onSearchClose?.();
            event.currentTarget.blur();
          }
        }
      }}
      onClear={onSearchClear}
      onClose={onSearchClose}
    />
  ) : null;

  const body = searchQuery.trim() ? (
    isSearchPending ? (
      <div className="py-6 text-center text-xs text-muted-foreground/50">Searching…</div>
    ) : searchGroups.length > 0 ? (
      searchGroups.map((group) => (
        <SearchFileGroup
          key={group.filePath}
          group={group}
          searchQuery={searchQuery}
          activeSearchMatchId={activeSearchMatchId ?? null}
          onSelectMatch={onSelectSearchMatch}
        />
      ))
    ) : (
      <div className="py-6 text-center text-xs text-muted-foreground/50">No matches found</div>
    )
  ) : effectiveGrouping === 'all' ? (
    <NavigatorCollection
      {...collectionCommonProps}
      items={allItems}
      keyPrefix={ALL_PREFIX}
      rowState={(item) => workingRowState(item, sections?.files[item.row.path]?.group === 'committed')}
      emptyLabel="No changed files"
    />
  ) : (
    <>
      <div className="mb-1">
        <SectionHeader
          label="Staged"
          collapsed={collapsedSections.has('staged')}
          onToggle={() => toggleSection('staged')}
          additions={stagedTotals.additions}
          deletions={stagedTotals.deletions}
          title="Changes in the index — what a commit would capture."
        />
        {!collapsedSections.has('staged') && (
          <NavigatorCollection
            {...collectionCommonProps}
            items={stagedItems}
            keyPrefix={`${WORKING_PREFIX}staged:`}
            rowState={(item) => workingRowState(item, false)}
            emptyLabel="Nothing staged"
          />
        )}
      </div>
      <div className="mb-1">
        <SectionHeader
          label="Unstaged"
          collapsed={collapsedSections.has('unstaged')}
          onToggle={() => toggleSection('unstaged')}
          additions={unstagedTotals.additions}
          deletions={unstagedTotals.deletions}
          title="Working-tree changes that are not in the index, including untracked files (U)."
        />
        {!collapsedSections.has('unstaged') && (
          <NavigatorCollection
            {...collectionCommonProps}
            items={unstagedItems}
            keyPrefix={`${WORKING_PREFIX}unstaged:`}
            rowState={(item) => workingRowState(item, false)}
            emptyLabel="No unstaged changes"
          />
        )}
      </div>
      {showCommitted && (
        <div className="mb-1">
          <SectionHeader
            label="Committed"
            collapsed={collapsedSections.has('committed')}
            onToggle={() => toggleSection('committed')}
            additions={committedTotals.additions}
            deletions={committedTotals.deletions}
            title="Commits in the selected review range — expand one to see the files it changed."
          />
          {!collapsedSections.has('committed') && (
            <NavigatorCommitSection
              commits={commits}
              base={commitsBase}
              hasMore={commitsHasMore}
              isLoading={commitsLoading}
              isLoadingMore={commitsLoadingMore}
              error={commitsError}
              onShowMore={() => onShowMoreCommits?.()}
              onRetry={() => onRetryCommits?.()}
              expandedCommits={expandedCommits ?? new Set()}
              onToggleCommit={(sha) => onToggleCommit?.(sha)}
              commitFiles={commitFiles ?? new Map()}
              onRetryCommitFiles={(sha) => onRetryCommitFiles?.(sha)}
              activeCommitSha={activeScopeSha}
              activeCommitFilePath={activeScopeSha ? activePath : null}
              layout={layout}
              collapsedFolders={collapsedFolders}
              onToggleFolder={toggleFolder}
              showViewedControls={showViewedControls}
              showStageControls={showStageControls}
              viewedInCommit={(sha, path) => isViewedInCommit?.(sha, path) ?? false}
              onToggleViewedInCommit={(sha, path) => onToggleViewedInCommit?.(sha, path)}
              annotationCount={annotationCount}
              onSelectCommitFile={(sha, path) => onSelectFile({ scope: { kind: 'commit', sha }, path })}
              repoRoot={repoRoot}
            />
          )}
        </div>
      )}
    </>
  );

  return (
    <aside
      className="border-r border-border/50 bg-card/30 flex flex-col flex-shrink-0 overflow-hidden"
      style={{ width: panelWidth }}
      data-review-navigator
    >
      {/* Fixed toolbar: identity, comparison pickers, the two display controls
          and the utility cluster. Everything below scrolls past it. */}
      <div className="px-3 flex items-center border-b border-border/50 flex-shrink-0" style={{ height: 'var(--panel-header-h)' }}>
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          {searchQuery.trim() ? 'Results' : 'Files'}
        </span>
      </div>

      {((worktrees && worktrees.length > 0 && onSelectWorktree) ||
        (diffOptions && diffOptions.length > 0 && onSelectDiff)) && (
        <div className="px-2 py-1.5 border-b border-border/30 flex gap-2 flex-shrink-0">
          {worktrees && worktrees.length > 0 && onSelectWorktree && (
            <div className="flex-1 min-w-0">
              <WorktreePicker
                worktrees={worktrees}
                activeWorktreePath={activeWorktreePath ?? null}
                currentBranch={currentBranch}
                onSelect={onSelectWorktree}
                disabled={isLoadingDiff}
              />
            </div>
          )}
          {diffOptions && diffOptions.length > 0 && onSelectDiff && (
            <div className="flex-1 min-w-0">
              <DiffTypePicker
                options={diffOptions}
                activeDiffType={activeDiffType || 'uncommitted'}
                onSelect={onSelectDiff}
                isLoading={isLoadingDiff}
                hasBasePicker={!!onSelectBase && !!availableBranches}
                activeBase={selectedBase}
              />
            </div>
          )}
        </div>
      )}

      {activeDiffType === 'jj-evolog' &&
        onSelectBase &&
        selectedBase &&
        jjEvologs &&
        jjEvologs.length >= 2 &&
        detectedEvoBase && (
          <div className="px-2 py-1.5 border-b border-border/30 flex items-center gap-2 flex-shrink-0">
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground flex-shrink-0">
              from evolution
            </span>
            <div className="flex-1 min-w-0">
              <EvoLogPicker
                entries={jjEvologs}
                selectedCommitId={selectedBase}
                detectedCommitId={detectedEvoBase}
                onSelect={onSelectBase}
                disabled={isLoadingDiff}
              />
            </div>
          </div>
        )}

      {activeDiffType !== 'jj-evolog' &&
        onSelectBase &&
        selectedBase &&
        detectedBase &&
        availableBranches &&
        activeDiffType &&
        compareTarget?.diffTypes.includes(activeDiffType) && (
          <div className="px-2 py-1.5 border-b border-border/30 flex items-center gap-2 flex-shrink-0">
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground flex-shrink-0">
              {compareTarget.picker.rowLabel}
            </span>
            <div className="flex-1 min-w-0">
              <BaseBranchPicker
                availableBranches={availableBranches}
                selectedBase={selectedBase}
                detectedBase={detectedBase}
                onSelectBase={onSelectBase}
                disabled={isLoadingDiff}
                copy={compareTarget.picker}
                recentCommits={recentCommits}
              />
            </div>
          </div>
        )}

      <NavigatorControls
        layout={layout}
        grouping={grouping}
        onSelectLayout={onSelectLayout}
        onSelectGrouping={onSelectGrouping}
        groupingDisabledReason={groupingDisabledReason}
        stacked={panelWidth < CONTROLS_STACK_WIDTH}
      />

      {/* Why the sections aren't on screen even though the control says they
          are — never an empty section header with no explanation. */}
      {groupingFallbackReason && !searchQuery.trim() && (
        <div className="px-2 py-1 text-[10px] leading-snug text-muted-foreground/80 border-b border-border/30 flex-shrink-0">
          {groupingFallbackReason}
        </div>
      )}

      <div className="flex-shrink-0 px-1">
        <PanelControlsRow
          stagedCount={stagedFiles.size}
          isSearchVisible={isSearchVisible}
          onOpenSearch={onOpenSearch}
          onToggleAllFolders={layout === 'tree' ? handleToggleAllFolders : undefined}
          areAllFoldersExpanded={areAllFoldersExpanded}
          collapseDisabled={allFolderKeys.length === 0}
          onToggleHideViewed={onToggleHideViewed}
          hideViewedFiles={hideViewedFiles}
          viewedCount={viewedFiles.size}
          totalCount={files.length}
          onCopyRawDiff={onCopyRawDiff}
          canCopyRawDiff={canCopyRawDiff}
          copyRawDiffStatus={copyRawDiffStatus}
          showViewedControls={showViewedControls}
          onToggleShowViewedControls={onToggleShowViewedControls}
          showStageControls={showStageControls}
          onToggleShowStageControls={onToggleShowStageControls}
          autoViewed={autoViewed}
          onToggleAutoViewed={onToggleAutoViewed}
        />
        {searchField}
      </div>

      <OverlayScrollArea className="flex-1 min-h-0">
        <div className="px-1 py-1">
          {prOverviewNumber && prOverviewTitle && onSelectPROverview && (
            <SidebarActionRow
              active={isPROverviewActive}
              onClick={onSelectPROverview}
              title={`${prOverviewNumber} · ${prOverviewTitle}`}
            >
              <GitHubIcon className="w-3.5 h-3.5 flex-shrink-0" />
              <span className="font-mono flex-shrink-0">{prOverviewNumber}</span>
              <span className="truncate text-muted-foreground/80">{prOverviewTitle}</span>
            </SidebarActionRow>
          )}
          {onSelectPRArtifacts && prArtifactCount !== undefined && (
            <SidebarActionRow
              active={isPRArtifactsActive}
              onClick={onSelectPRArtifacts}
              title="View attachments shared in this pull request or merge request"
            >
              <Paperclip className="w-3.5 h-3.5 flex-shrink-0" />
              <span>Artifacts</span>
              <span className="ml-auto rounded bg-muted px-1.5 py-0.5 font-mono text-[9px] tabular-nums text-muted-foreground">
                {prArtifactCount}
              </span>
            </SidebarActionRow>
          )}
          {callFlowEnabled && onSelectCallFlow && (
            <CallFlowRow
              active={isCallFlowActive}
              onClick={onSelectCallFlow}
              count={callFlowCount}
              loading={callFlowLoading}
              error={callFlowError}
            />
          )}
          {semanticDiffAvailable && onSelectSemanticDiff && (
            <SemanticDiffRow active={isSemanticDiffActive} onClick={onSelectSemanticDiff} />
          )}
          {onSelectAllFiles && (
            <AllFilesRow
              active={isAllFilesActive}
              onClick={onSelectAllFiles}
              additions={allTotals.additions}
              deletions={allTotals.deletions}
            />
          )}
          {body}
        </div>
      </OverlayScrollArea>
    </aside>
  );
};
