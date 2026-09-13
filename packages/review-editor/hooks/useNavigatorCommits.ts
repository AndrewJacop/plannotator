import { useCallback, useEffect, useRef, useState } from 'react';
import type { CommitFilesResult, CommitHistoryPage, CommitListEntry } from '@plannotator/shared/types';
import type { CommitFilesState } from '../components/NavigatorCommitSection';

const PAGE_SIZE = 50;
// Quiet head-compare poll cadence while the Committed section is visible. A
// commit's own diff is immutable (sha-anchored fingerprint — the staleness
// banner correctly never fires for it), so the LIST needs its own freshness:
// an agent committing while the reviewer reads must show up without a reload.
const POLL_INTERVAL_MS = 10_000;

interface UseNavigatorCommitsOptions {
  /** Fetch only while the Committed section can actually render. */
  enabled: boolean;
  /** History identity — refetch from page one when it changes (worktree
   * switch, base switch). A commit SELECTION must not be part of this key:
   * paging state has to survive reviewing a commit from a deep page. */
  contextKey: string;
}

export interface UseNavigatorCommitsReturn {
  commits: CommitListEntry[];
  /** Base ref the boundary represents (server echo), null before first load. */
  base: string | null;
  hasMore: boolean;
  isLoading: boolean;
  isLoadingMore: boolean;
  error: string | null;
  showMore: () => void;
  refresh: () => void;
  /** Per-commit file lists, populated lazily when a row is expanded. */
  commitFiles: ReadonlyMap<string, CommitFilesState>;
  /** Fetch (or re-fetch) one commit's files. Idempotent while in flight. */
  loadCommitFiles: (sha: string, options?: { force?: boolean }) => void;
}

/**
 * The Committed section's data layer: pages `GET /api/commits`, keeps the list
 * fresh with a quiet poll, and lazily resolves `GET /api/commit-files` for
 * expanded rows.
 *
 * Generation-guarded: a response from a superseded fetch (context changed,
 * refresh fired, poll adopted) is dropped so it can't overwrite newer state.
 * Successor of the retired `useCommitsView`, minus the machinery that belonged
 * to the old Commits MODE (HEAD auto-select and the centre-dock veil) — the
 * navigator never takes the diff over on its own now.
 */
export function useNavigatorCommits({
  enabled,
  contextKey,
}: UseNavigatorCommitsOptions): UseNavigatorCommitsReturn {
  const [commits, setCommits] = useState<CommitListEntry[]>([]);
  const [base, setBase] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [commitFiles, setCommitFiles] = useState<Map<string, CommitFilesState>>(new Map());
  const generationRef = useRef(0);
  const commitsRef = useRef(commits);
  commitsRef.current = commits;
  const baseRef = useRef(base);
  baseRef.current = base;

  const fetchPage = useCallback(async (before?: string) => {
    const generation = ++generationRef.current;
    const setBusy = before ? setIsLoadingMore : setIsLoading;
    setBusy(true);
    // A page-1 fetch supersedes any in-flight paging request, whose
    // generation-skipped `finally` will never clear its own flag — reset it
    // here or "Show more" stays stuck disabled as "Loading…".
    if (!before) setIsLoadingMore(false);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
      if (before) params.set('before', before);
      const res = await fetch(`/api/commits?${params}`);
      const data = (await res.json()) as CommitHistoryPage & { error?: string };
      if (generation !== generationRef.current) return;
      if (!res.ok || data.error) throw new Error(data.error || 'Failed to load commits');
      setCommits((prev) => {
        if (!before) return data.commits;
        // Append, deduping on sha — a concurrent refresh or a history that
        // moved between pages could otherwise repeat rows.
        const seen = new Set(prev.map((c) => c.sha));
        return [...prev, ...data.commits.filter((c) => !seen.has(c.sha))];
      });
      setBase(data.base || null);
      setHasMore(data.hasMore);
    } catch (err) {
      if (generation !== generationRef.current) return;
      setError(err instanceof Error ? err.message : 'Failed to load commits');
    } finally {
      if (generation === generationRef.current) setBusy(false);
    }
  }, []);

  // The context key the current list was loaded for. Re-entering with the SAME
  // key keeps the cached list (no empty flash before the refetch); a DIFFERENT
  // key (worktree/base switch) clears it, along with every cached commit file
  // list — those were resolved against the other context's cwd.
  const loadedContextKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!enabled) return;
    if (loadedContextKeyRef.current !== contextKey) {
      loadedContextKeyRef.current = contextKey;
      setCommits([]);
      setBase(null);
      setHasMore(false);
      setCommitFiles(new Map());
    }
    void fetchPage();
    // On disable, invalidate in-flight fetches AND reset their loading flags:
    // a generation-skipped `finally` never clears them.
    return () => {
      generationRef.current++;
      setIsLoading(false);
      setIsLoadingMore(false);
    };
  }, [enabled, contextKey, fetchPage]);

  // Quiet freshness poll: fetch page 1 and adopt it ONLY when what the list
  // shows would actually change — a new head, a moved base boundary, or a
  // relabeled base. No loading flags and no error churn: a transient network
  // blip during a background check must not disturb what the reviewer reads.
  const checkForNewCommits = useCallback(async () => {
    const generation = generationRef.current;
    try {
      const res = await fetch(`/api/commits?limit=${PAGE_SIZE}`);
      if (!res.ok) return;
      const data = (await res.json()) as CommitHistoryPage & { error?: string };
      if (data.error) return;
      if (generation !== generationRef.current) return;
      const current = commitsRef.current;
      const sameHead = data.commits[0]?.sha === current[0]?.sha;
      // Boundary compared over the overlap window: the current list may be
      // paged deeper than the poll's single page.
      const window = Math.min(data.commits.length, current.length);
      const boundaryIn = (list: readonly CommitListEntry[]): number => {
        for (let i = 0; i < window; i++) if (list[i].isPastBase) return i;
        return -1;
      };
      const sameBoundary = boundaryIn(data.commits) === boundaryIn(current);
      const sameBase = (data.base || null) === baseRef.current;
      if (sameHead && sameBoundary && sameBase) return;
      generationRef.current++;
      setCommits(data.commits);
      setBase(data.base || null);
      setHasMore(data.hasMore);
      setIsLoading(false);
      setIsLoadingMore(false);
      setError(null);
    } catch {
      /* transient — next poll tries again */
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const timer = setInterval(() => {
      void checkForNewCommits();
    }, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [enabled, checkForNewCommits]);

  const showMore = useCallback(() => {
    const last = commitsRef.current[commitsRef.current.length - 1];
    if (last) void fetchPage(last.sha);
  }, [fetchPage]);

  const refresh = useCallback(() => {
    void fetchPage();
  }, [fetchPage]);

  const commitFilesRef = useRef(commitFiles);
  commitFilesRef.current = commitFiles;

  const loadCommitFiles = useCallback((sha: string, options?: { force?: boolean }) => {
    const existing = commitFilesRef.current.get(sha);
    // A commit's diff is immutable, so a ready result is cached for the life
    // of the session; only an explicit Retry re-requests a failed one.
    if (existing && !options?.force && existing.status !== 'error') return;
    setCommitFiles((prev) => new Map(prev).set(sha, { status: 'loading' }));
    void (async () => {
      try {
        const res = await fetch(`/api/commit-files?sha=${encodeURIComponent(sha)}`);
        const data = (await res.json()) as CommitFilesResult & { error?: string };
        if (!res.ok || data.error) throw new Error(data.error || 'Failed to load commit files');
        setCommitFiles((prev) => new Map(prev).set(sha, { status: 'ready', files: data.files }));
      } catch (err) {
        setCommitFiles((prev) =>
          new Map(prev).set(sha, {
            status: 'error',
            error: err instanceof Error ? err.message : 'Failed to load commit files',
          }),
        );
      }
    })();
  }, []);

  return {
    commits,
    base,
    hasMore,
    isLoading,
    isLoadingMore,
    error,
    showMore,
    refresh,
    commitFiles,
    loadCommitFiles,
  };
}
