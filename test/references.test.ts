import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { describe, it, type TestContext } from "node:test";
import { ScheduleOneReferenceWorkspace } from "../src/references.js";
import { parseReferenceCatalog, type ReferenceSource } from "../src/reference-catalog.js";
import { assertEvidencePath, ReferenceEvidence } from "../src/reference-tools.js";
import type { WorkRequest } from "../src/types.js";

const execFileAsync = promisify(execFile);
const source: ReferenceSource = {
  id: "fixture", label: "Fixture", repository: "test/reference", branch: "beta",
  paths: ["Evidence"], depth: 3, access: "public", runtime: "mono",
};
const request = { actor: "maintainer" } as WorkRequest;

async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), "diffuin-reference-"));
  t.after(async () => rm(root, { recursive: true, force: true }));
  const origin = join(root, "origin");
  await mkdir(join(origin, "Evidence"), { recursive: true });
  const git = (...args: string[]) => execFileAsync("git", args, { cwd: origin, encoding: "utf8" });
  await git("init", "-b", "beta");
  await git("config", "user.name", "Diffuin Test");
  await git("config", "user.email", "diffuin@example.test");
  for (const version of ["f10", "f11"]) {
    await writeFile(join(origin, "Evidence", "Capture.cs"), `class Capture { string Version = "${version}"; }\n`);
    await git("add", ".");
    await git("commit", "-m", `Game ${version}`);
  }
  return { root, origin, git };
}

function redirect(t: TestContext, workspace: ScheduleOneReferenceWorkspace, origin: string) {
  const runner = workspace as unknown as {
    git(args: string[], cwd: string, env?: Record<string, string>): Promise<unknown>;
  };
  t.mock.method(runner, "git", (args: string[], cwd: string, env?: Record<string, string>) => {
    const localArgs = args.map((arg) => arg === "https://github.com/test/reference.git"
      ? pathToFileURL(origin).href : arg);
    // Keep the configured URL in Git config while redirecting network transport.
    if (args[0] === "remote" && args[1] === "get-url") return Promise.resolve({ stdout: "https://github.com/test/reference.git\n" });
    return execFileAsync("git", localArgs, { cwd, env, encoding: "utf8" });
  });
}

describe("reference evidence", () => {
  it("upgrades old depth-one partial caches so earlier source blobs remain readable offline", async (t) => {
    const { root, origin, git } = await fixture(t);
    await git("config", "uploadpack.allowFilter", "true");
    const data = join(root, "data");
    const cacheRoot = join(data, "references");
    const cache = join(cacheRoot, source.id);
    await mkdir(cacheRoot, { recursive: true });
    await execFileAsync("git", ["clone", "--depth", "1", "--filter=blob:none", "--sparse", "--branch", "beta", pathToFileURL(origin).href, cache]);
    await execFileAsync("git", ["sparse-checkout", "set", "Evidence"], { cwd: cache });
    const workspace = new ScheduleOneReferenceWorkspace(data, root, "unused", undefined, { sources: [source] });
    redirect(t, workspace, origin);
    const prepared = await workspace.prepare();
    assert.equal(prepared.warnings.length, 0);
    const config = await execFileAsync("git", ["config", "--local", "--list"], { cwd: cache });
    assert.doesNotMatch(config.stdout, /promisor|partialclone/);
    await rm(origin, { recursive: true, force: true });
    const evidence = new ReferenceEvidence(prepared.snapshots!);
    const history = await evidence.history("fixture");
    const previous = history.trim().split("\n")[1]!.split(" ")[0]!;
    assert.match(await evidence.read("fixture", "Evidence/Capture.cs", previous), /f10/);
  });

  it("refreshes a new head, compares cached history offline, and preserves stale evidence on fetch failure", async (t) => {
    const { root, origin, git } = await fixture(t);
    const workspace = new ScheduleOneReferenceWorkspace(join(root, "data"), root, "unused", undefined, { sources: [source] });
    redirect(t, workspace, origin);
    const first = await workspace.prepare();
    const snapshot = first.snapshots![0]!;
    assert.equal(snapshot.freshness, "refreshed");
    assert.match(snapshot.commitSubject, /f11/);
    assert.equal(first.warnings.length, 0);
    await writeFile(join(origin, "Evidence", "Capture.cs"), "class Capture { }\n");
    await git("add", ".");
    await git("commit", "-m", "Game f12");
    const second = await workspace.prepare();
    assert.match(second.snapshots![0]!.commitSubject, /f12/);
    await rm(origin, { recursive: true, force: true });
    const stale = await workspace.prepare();
    assert.equal(stale.snapshots![0]!.revision, second.snapshots![0]!.revision);
    assert.equal(stale.snapshots![0]!.freshness, "stale");
    assert.equal(stale.snapshots![0]!.checkedAt, "");
    assert.match(stale.warnings.join("\n"), /cached evidence is stale/);
    const evidence = new ReferenceEvidence(second.snapshots!);
    const history = await evidence.history("fixture");
    assert.match(history, /f10/);
    const commits = history.trim().split("\n").map((line) => line.split(" ")[0]!);
    assert.match(await evidence.diff("fixture", commits[2]!, commits[1]!, "Evidence/Capture.cs"), /f10[\s\S]*f11/);
    assert.match(await evidence.read("fixture", "Evidence/Capture.cs", commits[1]), /f11/);
    await assert.rejects(evidence.read("fixture", "Evidence/Capture.cs", "deadbeef"), /outside/);
    await assert.rejects(evidence.history("unauthorized"), /not authorized/);
    assert.throws(() => assertEvidencePath(snapshot, "Evidence/../secret.txt"));
    assert.throws(() => assertEvidencePath(snapshot, "EvidenceOther/Capture.cs"));
    assert.throws(() => assertEvidencePath(snapshot, ".git/config"));
  });

  it("does not expose an existing private cache after actor access is denied", async (t) => {
    const { root, origin } = await fixture(t);
    let permitted = true;
    const workspace = new ScheduleOneReferenceWorkspace(join(root, "data"), root, "unused", undefined, {
      sources: [{ ...source, access: "installation" }],
      authorize: async () => { if (!permitted) throw new Error("private-secret-error"); return "test-token"; },
    });
    redirect(t, workspace, origin);
    assert.equal((await workspace.prepare(request)).snapshots!.length, 1);
    permitted = false;
    const denied = await workspace.prepare(request);
    assert.equal(denied.snapshots!.length, 0);
    assert.match(denied.warnings.join("\n"), /both have repository read access/);
    assert.doesNotMatch(denied.warnings.join("\n"), /private-secret-error|test-token/);
  });

  it("validates deployment catalogs and rejects path/option injection", () => {
    assert.equal(parseReferenceCatalog([source])[0]!.depth, 3);
    for (const invalid of [
      [{ ...source, id: "../outside" }], [{ ...source, branch: "--upload-pack=evil" }],
      [{ ...source, paths: ["Evidence/../secret"] }], [source, source],
      [{ ...source, unknown: true }], [{ ...source, depth: 1000 }],
    ]) assert.throws(() => parseReferenceCatalog(invalid));
  });
});
