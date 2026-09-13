/**
 * GET /api/commit-files (#1524) — dual-runtime (Bun + Pi).
 *
 * The unified review navigator fetches this when a commit row is EXPANDED, so
 * the failures worth guarding are: a commit listing files it did not change
 * (wrong ref pair — the navigator would then scope the diff to a file the
 * patch has nothing for), the endpoint answering at all in a session with no
 * local git index (PR / workspace / jj / piped patch, where the Committed
 * section is not offered), and an unvalidated sha reaching git argv.
 */
import { afterEach, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { startReviewServer as startBunReviewServer } from './review';
import { startReviewServer as startPiReviewServer } from '../../apps/pi-extension/server';
import { getVcsContext } from './vcs';

const originalDataDir = process.env.PLANNOTATOR_DATA_DIR;
const originalPort = process.env.PLANNOTATOR_PORT;
const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function git(cwd: string, args: string[]): string {
  const result = spawnSync('git', args, { cwd, encoding: 'utf-8' });
  if (result.status !== 0) throw new Error(result.stderr || `git ${args.join(' ')} failed`);
  return result.stdout.trim();
}

function write(repoDir: string, path: string, body: string): void {
  const full = join(repoDir, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, body, 'utf-8');
}

/** A repo with two commits: the second touches only `src/second.ts`. */
function initRepo(): { repoDir: string; secondSha: string } {
  const repoDir = makeTempDir('plannotator-commit-files-endpoint-');
  git(repoDir, ['init', '-q']);
  git(repoDir, ['branch', '-M', 'main']);
  git(repoDir, ['config', 'user.email', 'test@example.com']);
  git(repoDir, ['config', 'user.name', 'Test']);
  write(repoDir, 'src/first.ts', 'one\n');
  git(repoDir, ['add', '.']);
  git(repoDir, ['commit', '-q', '-m', 'first']);
  write(repoDir, 'src/second.ts', 'two\nthree\n');
  git(repoDir, ['add', '.']);
  git(repoDir, ['commit', '-q', '-m', 'second']);
  return { repoDir, secondSha: git(repoDir, ['rev-parse', 'HEAD']) };
}

async function reservePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

const RAW_PATCH = [
  'diff --git a/src/second.ts b/src/second.ts',
  '--- a/src/second.ts',
  '+++ b/src/second.ts',
  '@@ -1 +1,2 @@',
  ' two',
  '+three',
].join('\n');

afterEach(() => {
  if (originalDataDir === undefined) delete process.env.PLANNOTATOR_DATA_DIR;
  else process.env.PLANNOTATOR_DATA_DIR = originalDataDir;
  if (originalPort === undefined) delete process.env.PLANNOTATOR_PORT;
  else process.env.PLANNOTATOR_PORT = originalPort;
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('GET /api/commit-files', () => {
  for (const [runtime, startServer] of [
    ['Bun', startBunReviewServer],
    ['Pi', startPiReviewServer],
  ] as const) {
    test(`${runtime} returns only the files that commit changed, with per-file counts`, async () => {
      process.env.PLANNOTATOR_DATA_DIR = makeTempDir('plannotator-commit-files-data-');
      if (runtime === 'Pi') process.env.PLANNOTATOR_PORT = String(await reservePort());
      const { repoDir, secondSha } = initRepo();
      const gitContext = await getVcsContext(repoDir, 'git');

      const server = await startServer({
        rawPatch: RAW_PATCH,
        gitRef: 'Working tree',
        diffType: 'uncommitted',
        gitContext,
        origin: runtime === 'Pi' ? 'pi' : 'claude-code',
        htmlContent: '<!doctype html><html><body>review</body></html>',
      });
      try {
        const res = await fetch(`${server.url}/api/commit-files?sha=${secondSha}`);
        expect(res.status).toBe(200);
        const data = (await res.json()) as {
          sha: string;
          files: { path: string; status: string; additions: number; deletions: number }[];
        };
        expect(data.sha).toBe(secondSha);
        // src/first.ts belongs to the FIRST commit — the combined branch diff
        // must not leak into a per-commit list.
        expect(data.files.map((f) => f.path)).toEqual(['src/second.ts']);
        expect(data.files[0]).toMatchObject({ status: 'added', additions: 2, deletions: 0 });
      } finally {
        server.stop();
      }
    });

    test(`${runtime} refuses a sha that is not a bare hex object id`, async () => {
      process.env.PLANNOTATOR_DATA_DIR = makeTempDir('plannotator-commit-files-data-');
      if (runtime === 'Pi') process.env.PLANNOTATOR_PORT = String(await reservePort());
      const { repoDir } = initRepo();
      const gitContext = await getVcsContext(repoDir, 'git');

      const server = await startServer({
        rawPatch: RAW_PATCH,
        gitRef: 'Working tree',
        diffType: 'uncommitted',
        gitContext,
        origin: runtime === 'Pi' ? 'pi' : 'claude-code',
        htmlContent: '<!doctype html><html><body>review</body></html>',
      });
      try {
        // `HEAD` resolves in git but is not an object id; the parameter reaches
        // git argv, so only bare hex is accepted.
        expect((await fetch(`${server.url}/api/commit-files?sha=HEAD`)).status).toBe(400);
        expect((await fetch(`${server.url}/api/commit-files?sha=`)).status).toBe(400);
        expect(
          (await fetch(`${server.url}/api/commit-files?sha=deadbeefdeadbeef`)).status,
        ).toBe(400);
      } finally {
        server.stop();
      }
    });

    test(`${runtime} rejects sessions with no local git history`, async () => {
      // Same gate as /api/commits, and the same gate the navigator applies
      // before it offers the Committed section at all.
      process.env.PLANNOTATOR_DATA_DIR = makeTempDir('plannotator-commit-files-data-');
      if (runtime === 'Pi') process.env.PLANNOTATOR_PORT = String(await reservePort());
      const server = await startServer({
        rawPatch: RAW_PATCH,
        gitRef: 'Piped diff',
        diffType: 'uncommitted',
        origin: runtime === 'Pi' ? 'pi' : 'claude-code',
        htmlContent: '<!doctype html><html><body>review</body></html>',
      });
      try {
        const res = await fetch(`${server.url}/api/commit-files?sha=${'a'.repeat(40)}`);
        expect(res.status).toBe(400);
        const data = (await res.json()) as { error?: string };
        expect(data.error).toBeTruthy();
      } finally {
        server.stop();
      }
    });
  }
});
