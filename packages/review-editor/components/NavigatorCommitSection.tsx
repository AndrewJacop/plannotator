import React from 'react';
import type { ReviewNavigatorLayout } from '@plannotator/ui/utils/reviewNavigator';
import type { CommitFileEntry, CommitListEntry } from '@plannotator/shared/types';
import { formatRelativeTime } from '@plannotator/ui/utils/aiChatFormat';
import { Avatar } from './Avatar';
import { DiffCounts } from './FileRowBits';
import { NavigatorCollection, type NavigatorRowState } from './NavigatorCollection';
import type { NavigatorFileItem } from '../utils/navigatorModel';

/**
 * The Committed section's body: one expandable row per commit in the review
 * range, newest first, with the same first-parent walk and base boundary the
 * retired Commits rail had.
 *
 * A row expands into the files THAT COMMIT changed (fetched lazily, see
 * `GET /api/commit-files`); selecting one of those files scopes the centre
 * diff to `commit:<sha>` rather than the combined branch diff. The row itself
 * carries only its subject and aggregate +/- — the author, avatar, relative
 * time and short sha ride a quiet second line, and the HEAD badge stays on the
 * first, so nothing the old rail exposed disappeared.
 */

export interface CommitFilesState {
  status: 'loading' | 'ready' | 'error';
  files?: CommitFileEntry[];
  error?: string;
}

const Caret: React.FC<{ expanded: boolean; className?: string }> = ({ expanded, className }) => (
  <svg
    className={`flex-shrink-0 transition-transform ${expanded ? 'rotate-90' : ''} ${className ?? ''}`}
    fill="none"
    viewBox="0 0 24 24"
    stroke="currentColor"
    strokeWidth={2}
    aria-hidden="true"
  >
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
  </svg>
);

/** Commits below this line are already part of the base — shared history. */
const BaseBoundary: React.FC<{ base: string }> = ({ base }) => (
  <div
    className="flex items-center gap-2 px-2 py-2"
    title={`Commits from here down are already part of ${base} — shared history, not branch work.`}
  >
    <span className="h-px flex-1 bg-foreground/30" />
    <span className="text-[11px] font-semibold text-foreground/80 truncate max-w-[160px]">In {base}</span>
    <span className="h-px flex-1 bg-foreground/30" />
  </div>
);

export const NavigatorCommitSection: React.FC<{
  commits: CommitListEntry[];
  base: string | null;
  hasMore: boolean;
  isLoading: boolean;
  isLoadingMore: boolean;
  error: string | null;
  onShowMore: () => void;
  onRetry: () => void;
  expandedCommits: ReadonlySet<string>;
  onToggleCommit: (sha: string) => void;
  commitFiles: ReadonlyMap<string, CommitFilesState>;
  onRetryCommitFiles: (sha: string) => void;
  /** Full sha of the commit whose diff is on screen, if any. */
  activeCommitSha: string | null;
  /** Path highlighted inside the active commit, if any. */
  activeCommitFilePath: string | null;
  layout: ReviewNavigatorLayout;
  collapsedFolders: ReadonlySet<string>;
  onToggleFolder: (key: string) => void;
  showViewedControls: boolean;
  showStageControls: boolean;
  viewedInCommit: (sha: string, path: string) => boolean;
  onToggleViewedInCommit: (sha: string, path: string) => void;
  annotationCount: (path: string) => number;
  onSelectCommitFile: (sha: string, path: string) => void;
  repoRoot?: string | null;
}> = ({
  commits,
  base,
  hasMore,
  isLoading,
  isLoadingMore,
  error,
  onShowMore,
  onRetry,
  expandedCommits,
  onToggleCommit,
  commitFiles,
  onRetryCommitFiles,
  activeCommitSha,
  activeCommitFilePath,
  layout,
  collapsedFolders,
  onToggleFolder,
  showViewedControls,
  showStageControls,
  viewedInCommit,
  onToggleViewedInCommit,
  annotationCount,
  onSelectCommitFile,
  repoRoot,
}) => {
  // isPastBase is a suffix of the linear walk (reachability from the base is
  // monotone along first parents), so one boundary is exhaustive.
  const boundaryIndex = commits.findIndex((c) => c.isPastBase);
  const showBoundary = boundaryIndex !== -1 && !!base;

  if (error && commits.length === 0) {
    return (
      <div className="px-2 py-3 space-y-2">
        <div className="text-xs text-destructive break-words">{error}</div>
        <button
          onClick={onRetry}
          className="text-[11px] text-primary/80 underline underline-offset-2 decoration-primary/40 hover:text-primary transition-colors"
        >
          Retry
        </button>
      </div>
    );
  }
  if (isLoading && commits.length === 0) {
    return <div className="px-2 py-3 text-[11px] text-muted-foreground/50">Loading commits…</div>;
  }
  if (commits.length === 0) {
    return <div className="px-2 py-1 text-[11px] text-muted-foreground/50">No commits on this branch</div>;
  }

  return (
    <>
      {commits.map((commit, index) => {
        const expanded = expandedCommits.has(commit.sha);
        const filesState = commitFiles.get(commit.sha);
        const isActiveCommit = commit.sha === activeCommitSha;
        const items: NavigatorFileItem<CommitFileEntry>[] = (filesState?.files ?? []).map((file) => ({
          row: file,
          untracked: false,
          staged: false,
        }));
        const rowState = (item: NavigatorFileItem<CommitFileEntry>): NavigatorRowState => ({
          isActive: isActiveCommit && item.row.path === activeCommitFilePath,
          isScrollActive: false,
          isViewed: viewedInCommit(commit.sha, item.row.path),
          annotationCount: annotationCount(item.row.path),
          // Committed content can't be staged; the green dot marks it and
          // keeps the column aligned with the working-tree sections.
          stageSlot: 'committed',
          isStaging: false,
        });

        return (
          <React.Fragment key={commit.sha}>
            {showBoundary && index === boundaryIndex && <BaseBoundary base={base!} />}
            <button
              onClick={() => onToggleCommit(commit.sha)}
              aria-expanded={expanded}
              data-commit-row={commit.sha}
              title={`${commit.sha}\n${commit.author} <${commit.authorEmail}>\n${commit.subject}`}
              className={`w-full text-left px-2 py-1.5 rounded-sm transition-colors ${
                isActiveCommit ? 'bg-primary/10' : 'hover:bg-muted/50'
              }`}
            >
              {/* Subject wraps; caret and totals align with its FIRST line. */}
              <div className="flex items-start gap-1.5 min-w-0">
                <Caret expanded={expanded} className="w-3 h-3 mt-[3px] text-muted-foreground" />
                <span className="text-xs flex-1 min-w-0 [overflow-wrap:anywhere]">{commit.subject}</span>
                {commit.isHead && (
                  <span className="text-[9px] leading-none px-1 py-0.5 mt-0.5 rounded bg-primary/15 text-primary font-medium flex-shrink-0">
                    HEAD
                  </span>
                )}
                {/* leading-4 matches the subject's `text-xs` line box, so the
                    smaller digits sit on the subject's FIRST line however
                    many lines it wraps to. */}
                <span className="leading-4">
                  <DiffCounts additions={commit.additions} deletions={commit.deletions} />
                </span>
              </div>
              {/* Quiet meta line — author, avatar, time, short sha. */}
              <div className="mt-0.5 ml-[18px] flex items-center gap-1.5 min-w-0">
                <Avatar src={commit.avatarUrl} name={commit.author} size={12} />
                <span className="text-[10px] text-muted-foreground/80 truncate">{commit.author}</span>
                <span className="text-[10px] text-muted-foreground/60 flex-shrink-0">
                  · {formatRelativeTime(commit.committedAt)}
                </span>
                <span className="flex-1" />
                <span className="font-mono text-[10px] text-muted-foreground/70 flex-shrink-0">
                  {commit.shortSha}
                </span>
              </div>
            </button>
            {expanded && filesState?.status === 'loading' && (
              <div className="px-2 py-1 text-[11px] text-muted-foreground/50" style={{ paddingLeft: 28 }}>
                Loading files…
              </div>
            )}
            {expanded && filesState?.status === 'error' && (
              <div className="px-2 py-1 flex items-center gap-2 text-[11px] text-destructive" style={{ paddingLeft: 28 }}>
                <span className="truncate flex-1" title={filesState.error}>
                  {filesState.error || 'Could not read this commit'}
                </span>
                <button
                  onClick={() => onRetryCommitFiles(commit.sha)}
                  className="flex-shrink-0 text-primary/80 underline underline-offset-2 decoration-primary/40 hover:text-primary transition-colors"
                >
                  Retry
                </button>
              </div>
            )}
            {expanded && filesState?.status === 'ready' && (
              <NavigatorCollection
                items={items}
                layout={layout}
                baseIndent={20}
                keyPrefix={`${commit.sha}:`}
                collapsedFolders={collapsedFolders}
                onToggleFolder={onToggleFolder}
                rowState={rowState}
                showViewedControls={showViewedControls}
                showStageControls={showStageControls}
                onSelect={(item) => onSelectCommitFile(commit.sha, item.row.path)}
                onToggleViewed={(item) => onToggleViewedInCommit(commit.sha, item.row.path)}
                repoRoot={repoRoot}
                emptyLabel="This commit changed no files"
              />
            )}
          </React.Fragment>
        );
      })}
      {hasMore && (
        <button
          onClick={onShowMore}
          disabled={isLoadingMore}
          className="w-full text-left px-2 py-1 text-[11px] text-primary/80 underline underline-offset-2 decoration-primary/40 hover:text-primary hover:decoration-primary transition-colors disabled:opacity-50"
        >
          {isLoadingMore ? 'Loading…' : 'Show more'}
        </button>
      )}
      {error && commits.length > 0 && (
        <div className="px-2 py-1.5 flex items-center gap-2 text-[11px] text-destructive">
          <span className="truncate flex-1" title={error}>
            {error}
          </span>
          <button
            onClick={onRetry}
            className="flex-shrink-0 text-primary/80 underline underline-offset-2 decoration-primary/40 hover:text-primary transition-colors"
          >
            Retry
          </button>
        </div>
      )}
    </>
  );
};
