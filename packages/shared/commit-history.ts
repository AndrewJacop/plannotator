/**
 * Commit-history rail — backs GET /api/commits and the commitInfo sidecar.
 *
 * Runtime-agnostic like review-core (Pi consumes a build-time copy via
 * vendor.sh). Deliberately separate from review-core: nothing here
 * participates in the diff-type dispatch — it is the Commits panel's data
 * layer (linear --first-parent pages + one commit's full metadata). The
 * commit:<sha> DIFF plumbing (parseCommitDiffType, the runGitDiff /
 * fingerprint / file-contents cases) stays in review-core with the other
 * diff types.
 */

import {
  BARE_HEX_SHA_RE,
  COMMIT_FIELD_SEP,
  getEmptyTreeSha,
  splitCommitFormatFields,
  type ReviewGitRuntime,
} from "./review-core";

// --- Commit history rail ------------------------------------------------------
//
// Backs GET /api/commits: the Commits panel's linear `--first-parent` walk from
// HEAD, newest first. Paged (before = the previous page's last sha), with a
// per-commit "past the base" flag so the client can draw the divider where the
// branch meets the resolved base.

export interface CommitListEntry {
  /** Full SHA — sent back as `commit:<sha>` on click. */
  sha: string;
  shortSha: string;
  subject: string;
  author: string;
  /** Author email — the key the avatar resolver matches on. */
  authorEmail: string;
  /** Committer time, epoch milliseconds. Clients format it themselves —
   * git's `%cr` relative strings are locale-dependent (gettext), so a
   * pre-formatted string couldn't be compacted reliably. */
  committedAt: number;
  isHead: boolean;
  /** True once the walk is at/below the base (reachable from it) — everything
   * above the first past-base commit is branch-local work. */
  isPastBase: boolean;
  /** Lines this commit adds vs its first parent, summed over its files. The
   * navigator shows these on a COLLAPSED commit row; the per-file breakdown
   * arrives separately from `listCommitFiles` when the row is expanded.
   * 0 when git reported no numstat for the commit (binary-only changes, or a
   * merge on a git that does not default `--first-parent` diffs). */
  additions: number;
  /** Lines this commit deletes vs its first parent. See `additions`. */
  deletions: number;
  /** Author profile image, when the forge could resolve one (server-enriched
   * via commit-avatars; absent → the client renders an initials fallback). */
  avatarUrl?: string;
}

export interface CommitHistoryPage {
  commits: CommitListEntry[];
  /** More history exists below this page. */
  hasMore: boolean;
  /** The base ref the divider represents (echoed for the divider label). */
  base: string;
}

/** Full metadata for ONE commit — the description card above the all-files
 * view when a `commit:<sha>` diff is active. */
export interface CommitDiffInfo {
  sha: string;
  shortSha: string;
  subject: string;
  /** Full message body (everything after the subject), "" when absent.
   * Rendered as markdown client-side. */
  body: string;
  author: string;
  authorEmail: string;
  /** Committer time, epoch milliseconds. Clients format it themselves —
   * git's `%cr` relative strings are locale-dependent (gettext), so a
   * pre-formatted string couldn't be compacted reliably. */
  committedAt: number;
  /** Author profile image (server-enriched via commit-avatars). */
  avatarUrl?: string;
}

/**
 * Fetch one commit's metadata for the description card. Best-effort: null
 * when the sha is invalid or doesn't resolve (callers omit the sidecar).
 */
export async function getCommitDiffInfo(
  runtime: ReviewGitRuntime,
  sha: string,
  cwd?: string,
): Promise<CommitDiffInfo | null> {
  if (!BARE_HEX_SHA_RE.test(sha)) return null;
  // Body (%b) is multiline, so it must be the LAST field — the rejoin target
  // of the shared splitter. A literal US byte in the subject would shift the
  // split (same accepted pathological edge as the list parsers).
  const fmt = ["%H", "%h", "%an", "%ae", "%ct", "%s", "%b"].join(COMMIT_FIELD_SEP);
  const result = await runtime.runGit(
    ["--no-optional-locks", "show", "-s", `--pretty=format:${fmt}`, "--end-of-options", sha],
    { cwd },
  );
  if (result.exitCode !== 0) return null;
  const fields = splitCommitFormatFields(result.stdout, 6, 0);
  if (!fields) return null;
  const [fullSha, shortSha, author, authorEmail, ct, subject, body] = fields;
  return {
    sha: fullSha,
    shortSha,
    author,
    authorEmail,
    committedAt: (Number(ct) || 0) * 1000,
    subject,
    body: body.trim(),
  };
}

/** One numstat row: `<adds>\t<dels>\t<path>`, with `-` for binary files. */
const NUMSTAT_LINE_RE = /^(\d+|-)\t(\d+|-)\t/;

/**
 * Parse `git log --pretty=format:<US fields> --numstat` output into commit
 * rows carrying their own summed +/-.
 *
 * Pure so the interleaving rule is testable without a repository: a line that
 * splits into the fixed field shape starts a new commit; a line matching the
 * numstat shape accumulates onto the commit most recently started; everything
 * else (blank separators) is ignored. Binary files report `-`/`-` and
 * contribute 0, which is why a binary-only commit legitimately reads `+0 -0`.
 */
export function parseCommitLogWithNumstat(
  stdout: string,
): Array<Omit<CommitListEntry, "isHead" | "isPastBase">> {
  const parsed: Array<Omit<CommitListEntry, "isHead" | "isPastBase">> = [];
  for (const line of stdout.split("\n")) {
    if (!line) continue;
    const fields = splitCommitFormatFields(line, 2, 3);
    if (fields) {
      const [sha, shortSha, subject, ct, author, authorEmail] = fields;
      parsed.push({
        sha,
        shortSha,
        subject,
        committedAt: (Number(ct) || 0) * 1000,
        author,
        authorEmail,
        additions: 0,
        deletions: 0,
      });
      continue;
    }
    const numstat = NUMSTAT_LINE_RE.exec(line);
    if (!numstat) continue;
    const current = parsed[parsed.length - 1];
    // Numstat before any commit line can't happen with this format, but a
    // defensive skip beats attributing it to nothing.
    if (!current) continue;
    current.additions += numstat[1] === "-" ? 0 : Number(numstat[1]);
    current.deletions += numstat[2] === "-" ? 0 : Number(numstat[2]);
  }
  return parsed;
}

/** One file changed by a single commit, as the navigator renders it. */
export interface CommitFileEntry {
  /** Repo-root-relative path (the post-change path for a rename). */
  path: string;
  /** Pre-rename path — present only for `renamed`. */
  oldPath?: string;
  status: "added" | "deleted" | "modified" | "renamed";
  additions: number;
  deletions: number;
  /** Git reported `-`/`-` for both columns: no line counts exist. */
  binary: boolean;
}

export interface CommitFilesResult {
  sha: string;
  files: CommitFileEntry[];
}

function mapNameStatus(code: string): CommitFileEntry["status"] {
  const letter = code[0];
  if (letter === "A") return "added";
  if (letter === "D") return "deleted";
  if (letter === "R") return "renamed";
  // C (copy) reads as an add of the new path; M/T/U and anything unexpected
  // are ordinary modifications as far as the navigator is concerned.
  if (letter === "C") return "added";
  return "modified";
}

/**
 * Zip one commit's `--name-status -z` and `--numstat` outputs into file rows.
 *
 * Pure, and deliberately index-based rather than path-keyed: both flags are
 * asked of the SAME diff invocation, so git emits the same entries in the same
 * order, while numstat's non-`-z` path column is shell-quoted for non-ASCII
 * names and would not match the `-z` path byte-for-byte. Extra numstat rows
 * (there should be none) are dropped rather than guessed at.
 */
export function zipCommitFileEntries(
  nameStatusZ: string,
  numstat: string,
): CommitFileEntry[] {
  // `-z` output is NUL-terminated fields: `<code>\0<path>\0`, and for renames
  // and copies `<code><score>\0<old>\0<new>\0`.
  const tokens = nameStatusZ.split("\0").filter((t) => t.length > 0);
  const counts: Array<{ additions: number; deletions: number; binary: boolean }> = [];
  for (const line of numstat.split("\n")) {
    const m = NUMSTAT_LINE_RE.exec(line);
    if (!m) continue;
    const binary = m[1] === "-" && m[2] === "-";
    counts.push({
      additions: m[1] === "-" ? 0 : Number(m[1]),
      deletions: m[2] === "-" ? 0 : Number(m[2]),
      binary,
    });
  }

  const files: CommitFileEntry[] = [];
  for (let i = 0; i < tokens.length; ) {
    const code = tokens[i++];
    const isPair = code[0] === "R" || code[0] === "C";
    const first = tokens[i++];
    if (first === undefined) break;
    const second = isPair ? tokens[i++] : undefined;
    if (isPair && second === undefined) break;
    const count = counts[files.length] ?? { additions: 0, deletions: 0, binary: false };
    files.push({
      path: isPair ? (second as string) : first,
      ...(isPair && code[0] === "R" ? { oldPath: first } : {}),
      status: mapNameStatus(code),
      additions: count.additions,
      deletions: count.deletions,
      binary: count.binary,
    });
  }
  return files;
}

/**
 * The files one commit changed vs its first parent, with per-file +/-.
 *
 * Backs `GET /api/commit-files`, which the unified navigator calls when a
 * commit row is EXPANDED — the row itself only needs the aggregate that rides
 * `listCommitHistory`, so a session that never expands a commit never pays
 * for this.
 *
 * The ref pair matches runGitDiff's `commit:<sha>` case exactly (first parent,
 * or the empty tree for a root commit), so the file list can never disagree
 * with the patch a click on one of these rows then renders.
 *
 * Returns null when the sha is not a bare hex object id or does not resolve.
 */
export async function listCommitFiles(
  runtime: ReviewGitRuntime,
  sha: string,
  cwd?: string,
): Promise<CommitFilesResult | null> {
  if (!BARE_HEX_SHA_RE.test(sha)) return null;
  const runReadOnlyGit = (args: string[]) =>
    runtime.runGit(["--no-optional-locks", ...args], { cwd });

  const resolved = await runReadOnlyGit(["rev-parse", "--verify", "--quiet", `${sha}^{commit}`]);
  if (resolved.exitCode !== 0) return null;
  const fullSha = resolved.stdout.trim() || sha;

  const hasParent =
    (await runReadOnlyGit(["rev-parse", "--verify", "--quiet", `${fullSha}^`])).exitCode === 0;
  const baseRef = hasParent ? `${fullSha}^` : await getEmptyTreeSha(runtime, cwd);
  const range = `${baseRef}..${fullSha}`;

  const diffArgs = (format: string[]) => [
    "diff",
    "--no-ext-diff",
    "-M",
    ...format,
    "--end-of-options",
    range,
  ];
  const [nameStatus, numstat] = await Promise.all([
    runReadOnlyGit(diffArgs(["--name-status", "-z"])),
    runReadOnlyGit(diffArgs(["--numstat"])),
  ]);
  if (nameStatus.exitCode !== 0 || numstat.exitCode !== 0) return null;

  return { sha: fullSha, files: zipCommitFileEntries(nameStatus.stdout, numstat.stdout) };
}

const COMMIT_HISTORY_LIMIT_DEFAULT = 50;
const COMMIT_HISTORY_LIMIT_MAX = 200;

/**
 * One page of the linear (`--first-parent`) history from HEAD. Returns null
 * when the repo can't answer at all (no HEAD, not a repo); an unresolvable
 * `before` yields an empty terminal page instead (the commit paged past may
 * be a root commit, whose `^` doesn't resolve).
 */
export async function listCommitHistory(
  runtime: ReviewGitRuntime,
  defaultBranch: string,
  cwd?: string,
  options?: { limit?: number; before?: string },
): Promise<CommitHistoryPage | null> {
  const requested = options?.limit ?? COMMIT_HISTORY_LIMIT_DEFAULT;
  const limit = Math.max(1, Math.min(Math.floor(requested), COMMIT_HISTORY_LIMIT_MAX));
  const before = options?.before;
  // `before` flows into a git argv position — same bare-hex rule as commit:<sha>.
  if (before !== undefined && !BARE_HEX_SHA_RE.test(before)) return null;
  const emptyPage: CommitHistoryPage = { commits: [], hasMore: false, base: defaultBranch };

  // --no-optional-locks throughout: read-only queries that may run while the
  // agent stages/commits concurrently.
  const runReadOnlyGit = (args: string[]) =>
    runtime.runGit(["--no-optional-locks", ...args], { cwd });

  // A cursor from a rewritten history (rebase/force-push mid-session) still
  // resolves in the object store but is no longer on the branch — paging on
  // from it would walk the orphaned pre-rewrite chain. A non-ancestor (or
  // vanished) cursor ends the pagination with an empty terminal page; the
  // client's freshness poll replaces the list moments later.
  if (before) {
    const onBranch = await runReadOnlyGit([
      "merge-base",
      "--is-ancestor",
      "--end-of-options",
      before,
      "HEAD",
    ]);
    if (onBranch.exitCode !== 0) return emptyPage;
  }

  // Continue the first-parent walk from `before`'s first parent. +1 over the
  // limit so hasMore is observed, not guessed.
  const startRef = before ? `${before}^` : "HEAD";
  const fmt = ["%H", "%h", "%s", "%ct", "%an", "%ae"].join(COMMIT_FIELD_SEP);
  // `--numstat` rides along so every row can show its own +/- aggregate
  // without a second walk. Its lines interleave with the format lines and are
  // rejected by splitCommitFormatFields (no US bytes), so the commit parser
  // below is unaffected — `sumNumstat` picks them up instead.
  const log = await runReadOnlyGit([
    "log",
    "--first-parent",
    "--numstat",
    `--max-count=${limit + 1}`,
    `--pretty=format:${fmt}`,
    "--end-of-options",
    startRef,
  ]);
  if (log.exitCode !== 0) {
    // Paging past a root commit (`before^` unresolvable) is a normal terminal
    // page. A first page failing because the repo simply has no commits yet
    // (no HEAD) is also an empty page, not an error — every other review
    // surface degrades gracefully on a commit-less repo. Anything else
    // (not a repo at all) stays null → the endpoint reports a real error.
    if (before) return emptyPage;
    const headResolves =
      (await runReadOnlyGit(["rev-parse", "--verify", "--quiet", "HEAD"])).exitCode === 0;
    return headResolves ? null : emptyPage;
  }

  const parsed = parseCommitLogWithNumstat(log.stdout);
  const hasMore = parsed.length > limit;
  const page = parsed.slice(0, limit);

  const [head, branchOnly] = await Promise.all([
    runReadOnlyGit(["rev-parse", "HEAD"]),
    // The branch-local set: first-parent commits from HEAD NOT reachable from
    // the base. Reachability (not merge-base position) is what the divider
    // means — a base merged INTO the branch keeps its commits below the line.
    // Best-effort: an unresolvable base yields no divider (all isPastBase
    // false), matching how since-base degrades on such repos.
    defaultBranch
      ? runReadOnlyGit(["rev-list", "--first-parent", "--end-of-options", "HEAD", `^${defaultBranch}`])
      : Promise.resolve(null),
  ]);
  const headSha = head.exitCode === 0 ? head.stdout.trim() : "";
  const branchLocal = branchOnly && branchOnly.exitCode === 0
    ? new Set(branchOnly.stdout.split("\n").filter(Boolean))
    : null;

  return {
    commits: page.map((c) => ({
      ...c,
      isHead: c.sha === headSha,
      isPastBase: branchLocal ? !branchLocal.has(c.sha) : false,
    })),
    hasMore,
    base: defaultBranch,
  };
}

