/**
 * Per-commit file lists — the data behind an expanded commit row in the
 * unified review navigator.
 *
 * The failures worth guarding: a commit row listing files the commit's own
 * diff does not contain (wrong ref pair), the numbers and the statuses drifting
 * apart (the two git invocations are zipped BY INDEX, which only holds because
 * both describe the same diff), and a root commit — no parent to diff against —
 * reporting nothing.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve as resolvePath } from "node:path";
import {
  listCommitFiles,
  listCommitHistory,
  parseCommitLogWithNumstat,
  zipCommitFileEntries,
} from "./commit-history";
import { COMMIT_FIELD_SEP, type ReviewGitRuntime } from "./review-core";

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function git(cwd: string, args: string[]): string {
  const result = spawnSync("git", args, { cwd, encoding: "utf-8" });
  if (result.status !== 0) throw new Error(result.stderr || `git ${args.join(" ")} failed`);
  return result.stdout.trim();
}

function makeRuntime(baseCwd: string): ReviewGitRuntime {
  return {
    async getFileInfo() {
      return null;
    },
    async readLink() {
      return null;
    },
    async runGit(args: string[], options?: { cwd?: string }) {
      const result = spawnSync("git", args, { cwd: options?.cwd ?? baseCwd, encoding: "utf-8" });
      return {
        stdout: result.stdout ?? "",
        stderr: result.stderr ?? "",
        exitCode: result.status ?? (result.error ? 1 : 0),
      };
    },
    async readTextFile(path: string) {
      try {
        return readFileSync(path.startsWith("/") ? path : resolvePath(baseCwd, path), "utf-8");
      } catch {
        return null;
      }
    },
  };
}

function write(repoDir: string, path: string, body: string): void {
  const full = join(repoDir, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, body, "utf-8");
}

function initRepo(): string {
  const repoDir = makeTempDir("plannotator-commit-files-");
  git(repoDir, ["init"]);
  git(repoDir, ["branch", "-M", "main"]);
  git(repoDir, ["config", "user.email", "nav@example.com"]);
  git(repoDir, ["config", "user.name", "Navigator"]);
  return repoDir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("parseCommitLogWithNumstat", () => {
  const fields = (sha: string, subject: string) =>
    [sha, sha.slice(0, 7), subject, "1700000000", "Navigator", "nav@example.com"].join(COMMIT_FIELD_SEP);

  test("attributes each numstat block to the commit that opened it", () => {
    // Failure caught: the aggregate on one commit row showing another
    // commit's numbers, which is what a naive line loop produces when the
    // format and numstat lines interleave.
    const rows = parseCommitLogWithNumstat(
      [fields("a".repeat(40), "second"), "", "3\t1\tsrc/a.ts", "10\t0\tsrc/b.ts", "",
       fields("b".repeat(40), "first"), "", "1\t2\tsrc/a.ts"].join("\n"),
    );
    expect(rows.map((r) => [r.subject, r.additions, r.deletions])).toEqual([
      ["second", 13, 1],
      ["first", 1, 2],
    ]);
  });

  test("binary files contribute nothing rather than NaN", () => {
    const rows = parseCommitLogWithNumstat(
      [fields("c".repeat(40), "add a png"), "", "-\t-\tlogo.png", "4\t0\tsrc/a.ts"].join("\n"),
    );
    expect(rows[0].additions).toBe(4);
    expect(rows[0].deletions).toBe(0);
  });
});

describe("zipCommitFileEntries", () => {
  test("pairs statuses with counts and reads renames as a path pair", () => {
    // `--name-status -z` emits `R<score>\0old\0new\0` while `--numstat` prints
    // one row per entry in the same order — the zip is by index for exactly
    // that reason, since numstat's path column is shell-quoted.
    const files = zipCommitFileEntries(
      ["A\0src/new.ts\0", "R091\0src/old.ts\0src/moved.ts\0", "D\0src/gone.ts\0", "M\0src/keep.ts\0"].join(""),
      ["12\t0\tsrc/new.ts", "1\t1\tsrc/{old => moved}.ts", "0\t9\tsrc/gone.ts", "2\t3\tsrc/keep.ts"].join("\n"),
    );
    expect(files).toEqual([
      { path: "src/new.ts", status: "added", additions: 12, deletions: 0, binary: false },
      { path: "src/moved.ts", oldPath: "src/old.ts", status: "renamed", additions: 1, deletions: 1, binary: false },
      { path: "src/gone.ts", status: "deleted", additions: 0, deletions: 9, binary: false },
      { path: "src/keep.ts", status: "modified", additions: 2, deletions: 3, binary: false },
    ]);
  });

  test("a binary file is flagged rather than reported as a zero-line change", () => {
    const files = zipCommitFileEntries("A\0logo.png\0", "-\t-\tlogo.png");
    expect(files[0].binary).toBe(true);
    expect(files[0].additions).toBe(0);
  });

  test("missing numstat rows degrade to zeros instead of dropping the file", () => {
    const files = zipCommitFileEntries("M\0a.ts\0M\0b.ts\0", "5\t5\ta.ts");
    expect(files.map((f) => f.path)).toEqual(["a.ts", "b.ts"]);
    expect(files[1]).toMatchObject({ additions: 0, deletions: 0 });
  });
});

describe("listCommitFiles", () => {
  test("lists exactly what the commit changed vs its first parent", async () => {
    const repoDir = initRepo();
    const runtime = makeRuntime(repoDir);
    write(repoDir, "src/a.ts", "one\ntwo\n");
    write(repoDir, "src/keep.ts", "same\n");
    git(repoDir, ["add", "."]);
    git(repoDir, ["commit", "-m", "root"]);

    write(repoDir, "src/a.ts", "one\ntwo\nthree\n");
    write(repoDir, "src/new.ts", "hello\n");
    git(repoDir, ["add", "."]);
    git(repoDir, ["commit", "-m", "second"]);
    const sha = git(repoDir, ["rev-parse", "HEAD"]);

    const result = await listCommitFiles(runtime, sha, repoDir);
    expect(result).not.toBeNull();
    expect(result!.sha).toBe(sha);
    // Failure caught: the combined branch diff leaking in — src/keep.ts is
    // untouched by THIS commit and must not appear under it.
    expect(result!.files.map((f) => f.path).sort()).toEqual(["src/a.ts", "src/new.ts"]);
    const added = result!.files.find((f) => f.path === "src/new.ts")!;
    expect(added.status).toBe("added");
    expect(added.additions).toBe(1);
    const modified = result!.files.find((f) => f.path === "src/a.ts")!;
    expect(modified.status).toBe("modified");
    expect(modified.additions).toBe(1);
    expect(modified.deletions).toBe(0);
  });

  test("a root commit diffs against the empty tree rather than reporting nothing", async () => {
    const repoDir = initRepo();
    const runtime = makeRuntime(repoDir);
    write(repoDir, "src/a.ts", "one\n");
    git(repoDir, ["add", "."]);
    git(repoDir, ["commit", "-m", "root"]);
    const sha = git(repoDir, ["rev-parse", "HEAD"]);

    const result = await listCommitFiles(runtime, sha, repoDir);
    expect(result!.files).toEqual([
      { path: "src/a.ts", status: "added", additions: 1, deletions: 0, binary: false },
    ]);
  });

  test("a non-hex or unresolvable sha fails closed", async () => {
    const repoDir = initRepo();
    const runtime = makeRuntime(repoDir);
    write(repoDir, "a.ts", "x\n");
    git(repoDir, ["add", "."]);
    git(repoDir, ["commit", "-m", "root"]);

    // `HEAD` is deliberately refused: the sha reaches git argv, so only bare
    // hex object ids are accepted.
    expect(await listCommitFiles(runtime, "HEAD", repoDir)).toBeNull();
    expect(await listCommitFiles(runtime, "deadbeefdeadbeef", repoDir)).toBeNull();
  });
});

describe("listCommitHistory aggregates", () => {
  test("each row carries its own +/- so a collapsed commit needs no expansion", async () => {
    const repoDir = initRepo();
    const runtime = makeRuntime(repoDir);
    write(repoDir, "a.ts", "1\n2\n3\n");
    git(repoDir, ["add", "."]);
    git(repoDir, ["commit", "-m", "root"]);
    write(repoDir, "a.ts", "1\n");
    write(repoDir, "b.ts", "x\ny\n");
    git(repoDir, ["add", "."]);
    git(repoDir, ["commit", "-m", "second"]);

    const page = await listCommitHistory(runtime, "main", repoDir);
    expect(page).not.toBeNull();
    const [second, root] = page!.commits;
    expect(second.subject).toBe("second");
    // 2 lines added in b.ts, 2 removed from a.ts.
    expect([second.additions, second.deletions]).toEqual([2, 2]);
    expect([root.additions, root.deletions]).toEqual([3, 0]);
  });
});
