/**
 * Programmatic git-repo builder for adapter tests (AR10).
 *
 * Builds a throwaway git repo in the OS temp dir via `execFile`/git in setup,
 * and removes it in teardown. No binary `.git` snapshots are committed to this
 * repository.
 */

import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd });
  return stdout;
}

/** Run an arbitrary git command in `repo` (e.g. `mv`, `rm`) for test setup. */
export async function gitExec(repo: string, args: string[]): Promise<string> {
  return git(repo, args);
}

/** Create a fresh temp git repo with deterministic identity/config. */
export async function makeTempRepo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "blastcheck-git-"));
  await git(dir, ["init", "-q", "-b", "main"]);
  await git(dir, ["config", "user.email", "test@blastcheck.dev"]);
  await git(dir, ["config", "user.name", "blastcheck-test"]);
  await git(dir, ["config", "commit.gpgsign", "false"]);
  return dir;
}

/** File contents may be text (string) or binary (Uint8Array). */
export type FileSpec = Record<string, string | Uint8Array>;

/** Write `files`, stage everything, commit, and return the new commit sha. */
export async function commit(repo: string, files: FileSpec, message: string): Promise<string> {
  for (const [rel, content] of Object.entries(files)) {
    const full = join(repo, rel);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, content);
  }
  await git(repo, ["add", "-A"]);
  await git(repo, ["commit", "-q", "-m", message]);
  return (await git(repo, ["rev-parse", "HEAD"])).trim();
}

/** Recursively remove a temp repo created by {@link makeTempRepo}. */
export async function cleanupRepo(repo: string): Promise<void> {
  await rm(repo, { recursive: true, force: true });
}

/** A path that is guaranteed NOT to be a git repository. */
export async function makeNonRepoDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "blastcheck-nonrepo-"));
}
