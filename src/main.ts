import { join } from "node:path";
import { CodexClient } from "./codex.js";
import { loadConfig } from "./config.js";
import { GitWorkspace } from "./git.js";
import { GitHubClient } from "./github.js";
import { createDiffuinServer } from "./server.js";
import { JobStore } from "./store.js";
import { Worker } from "./worker.js";
import { ScheduleOneReferenceWorkspace } from "./references.js";

const config = loadConfig();
const store = new JobStore(join(config.dataDir, "diffuin.sqlite"));
const github = new GitHubClient(config.githubAppId, config.githubPrivateKey, config.githubWebhookSecret);
const codex = new CodexClient(config.dataDir);
const references = new ScheduleOneReferenceWorkspace(
  config.dataDir,
  config.scheduleOneSkillPath,
  config.scheduleOneCodeArchiverUrl,
  config.scheduleOneRelatedRepositories,
  config.scheduleOneAssetRipperPath,
);
const worker = new Worker(config, store, github, codex, new GitWorkspace(config.dataDir), references);
const server = createDiffuinServer(config, store, github);

server.listen(config.port, "0.0.0.0", () => {
  console.log(`Diffuin listening on port ${config.port}`);
});

void worker.start().catch((error: unknown) => {
  console.error("Diffuin worker stopped unexpectedly", error);
  process.exitCode = 1;
  server.close();
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    worker.stop();
    server.close(() => {
      store.close();
      process.exit(0);
    });
  });
}
