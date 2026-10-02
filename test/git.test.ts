import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { describe, it } from "node:test";
import { GitWorkspace, gitAuthEnvironment } from "../src/git.js";

const execFileAsync = promisify(execFile);

describe("GitWorkspace repository guidance", () => {
  it("prepares all base blobs before locking Git metadata", async (t) => {
    const root = await mkdtemp(join(tmpdir(), "diffuin-complete-clone-"));
    const origin = join(root, "origin");
    const workspace = new GitWorkspace(join(root, "data"));
    let preparedPath: string | undefined;
    try {
      await mkdir(origin);
      await git(origin, "init", "-b", "base");
      await git(origin, "config", "user.name", "Diffuin Test");
      await git(origin, "config", "user.email", "diffuin@example.test");
      await git(origin, "config", "uploadpack.allowFilter", "true");
      await writeFile(join(origin, "AGENTS.md"), "Trusted base guidance.\n");
      await writeFile(join(origin, "source.txt"), "Base-only content.\n");
      await git(origin, "add", ".");
      await git(origin, "commit", "-m", "base");
      await git(origin, "checkout", "-b", "head");
      await writeFile(join(origin, "AGENTS.md"), "Contributor head guidance.\n");
      await writeFile(join(origin, "source.txt"), "Changed head content.\n");
      await git(origin, "add", ".");
      await git(origin, "commit", "-m", "head");

      // Replace only the remote transport; execute the real preparation and Git commands.
      const gitRunner = workspace as unknown as {
        git(args: string[], cwd: string, environment?: Record<string, string>): Promise<unknown>;
      };
      t.mock.method(gitRunner, "git", async (args: string[], cwd: string, environment?: Record<string, string>) => {
        const localArgs = args.map((arg) => arg === "https://github.com/test/repository.git"
          ? pathToFileURL(origin).href
          : arg);
        return execFileAsync("git", localArgs, { cwd, env: environment, encoding: "utf8" });
      });

      const prepared = await workspace.prepare({
        jobId: "complete-clone", owner: "test", repo: "repository", sourceRef: "head",
        comparisonRef: "base", token: "test-token", issueNumber: 334,
      });
      preparedPath = prepared.path;
      assert.equal(prepared.comparisonReference, "refs/diffuin/base");
      const config = await execFileAsync("git", ["config", "--local", "--list"], { cwd: prepared.path });
      assert.doesNotMatch(config.stdout, /promisor|partialclone/i);
      if (process.platform !== "win32") {
        assert.equal((await stat(join(prepared.path, ".git", "objects", "pack"))).mode & 0o222, 0);
      }

      // No remote remains to satisfy an accidental lazy fetch.
      await rm(origin, { recursive: true, force: true });
      assert.deepEqual(await workspace.readRepositoryGuidance(prepared.path, prepared.comparisonReference), [
        "Trusted base guidance.\n",
      ]);
      assert.deepEqual(await workspace.readRepositoryGuidance(prepared.path), ["Contributor head guidance.\n"]);
      const diff = await execFileAsync("git", ["diff", `${prepared.comparisonReference}...HEAD`], { cwd: prepared.path });
      assert.match(diff.stdout, /-Base-only content/);
      assert.match(diff.stdout, /\+Changed head content/);
    } finally {
      if (preparedPath) await workspace.cleanup(preparedPath);
      await rm(root, { recursive: true, force: true });
    }
  });

  it("reads tracked guidance from the requested trusted reference", async () => {
    const root = await mkdtemp(join(tmpdir(), "diffuin-guidance-"));
    const repository = join(root, "repository");
    try {
      await mkdir(join(repository, ".github"), { recursive: true });
      await git(repository, "init");
      await git(repository, "config", "user.name", "Diffuin Test");
      await git(repository, "config", "user.email", "diffuin@example.test");
      await writeFile(
        join(repository, "AGENTS.md"),
        "Use [S1API](https://github.com/ifBars/S1API).\n",
        "utf8",
      );
      await writeFile(
        join(repository, ".github", "CONTRIBUTING.md"),
        "Compare https://github.com/k073l/s1-codearchiver when needed.\n",
        "utf8",
      );
      await git(repository, "add", ".");
      await git(repository, "commit", "-m", "trusted guidance");
      await git(repository, "update-ref", "refs/diffuin/base", "HEAD");
      await writeFile(
        join(repository, "AGENTS.md"),
        "Read https://github.com/private/ContributorControlled.\n",
        "utf8",
      );

      const workspace = new GitWorkspace(join(root, "data"));
      const guidance = await workspace.readRepositoryGuidance(repository, "refs/diffuin/base");

      assert.equal(guidance.length, 2);
      assert.match(guidance.join("\n"), /ifBars\/S1API/);
      assert.match(guidance.join("\n"), /k073l\/s1-codearchiver/);
      assert.doesNotMatch(guidance.join("\n"), /ContributorControlled/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("GitWorkspace authentication", () => {
  it("supplies the installation token through Git's credential protocol", async () => {
    const token = "github_pat_test-token";
    const environment = gitAuthEnvironment(token, tmpdir());

    assert.doesNotMatch(environment.GIT_CONFIG_VALUE_0 ?? "", /github_pat_test-token/);
    assert.equal(environment.DIFFUIN_GITHUB_TOKEN, token);

    const credentials = await fillCredentials(environment);

    assert.match(credentials, /^username=x-access-token$/m);
    assert.match(credentials, /^password=github_pat_test-token$/m);
  });
});

async function git(cwd: string, ...args: string[]): Promise<void> {
  await execFileAsync("git", args, { cwd, encoding: "utf8" });
}

async function fillCredentials(environment: Record<string, string>): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", ["credential", "fill"], {
      env: environment,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`git credential fill failed (${code}): ${stderr}`));
    });
    child.stdin.end("protocol=https\nhost=github.com\n\n");
  });
}
