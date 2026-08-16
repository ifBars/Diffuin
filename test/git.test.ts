import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, it } from "node:test";
import { GitWorkspace, gitAuthEnvironment } from "../src/git.js";

const execFileAsync = promisify(execFile);

describe("GitWorkspace repository guidance", () => {
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
