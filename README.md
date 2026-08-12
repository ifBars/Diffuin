# Diffuin

Diffuin is a small, self-hosted GitHub App for Schedule One mod repositories.
An `@Diffuin` mention asks a configured coding-agent harness to review a pull request against game source,
refine or plan an issue, answer a focused modding question, or implement an
explicitly requested change.

This is a personal review bot and project built for my own Schedule One modding
workflow. It is not designed or supported as a general-purpose product for
other users, but it is released under the MIT License, so anyone is welcome to
use, modify, or adapt it for their own workflow.

Diffuin combines the target repository's instructions with a bundled,
public-safe Schedule One modding skill. At job time it refreshes shallow,
read-only checkouts of the regular and beta stripped-source branches from
[S1CodeArchiver](https://github.com/k073l/s1-codearchiver). A local self-hosted
instance may also mount an AssetRipper export read-only. For repositories,
issues, pull requests, and files explicitly linked in the request or its
conversation, Diffuin exposes a session-scoped, read-only GitHub tool broker.

## What it does

1. Verifies the GitHub webhook signature.
2. Accepts new issue comments and pull-request review comments containing the
   configured mention.
3. Requires the repository to be allowlisted and the requesting actor to have
   write-equivalent permission.
4. Queues the delivery idempotently in SQLite.
5. Refreshes regular (`alternate`) and beta (`alternate-beta`) game-source
   references before starting the selected harness.
6. Starts a short-lived localhost GitHub read session scoped to the current and
   explicitly mentioned repositories. Public repositories are readable;
   private repositories additionally require the requesting actor to have
   access through the App installation.
7. Runs the selected Codex or Spark provider in a fresh checkout. Reference
   directories are readable but outside the writable checkout, and the only
   model-visible remote research surface is the read-only broker. Spark command
   execution is disabled by default because its command tool is not an OS sandbox.
8. For pull requests, fetches the base branch so Codex can review the complete
   base-to-head diff.
9. Scans the response and patch for common secret formats.
10. Passes the authorized message to the selected harness, which interprets the requested
    outcome and loads the applicable `review-issue`, `implement-issue`,
    `review-pull-request`, or `change-pull-request` skill. Explicit command modes
    remain hard constraints.
11. Edits a single status comment into a compact review or plan. PR findings
    are posted on the relevant diff lines when GitHub accepts the location.
12. Publishes changes only when the harness declares implementation intent and the
    checkout actually changed. Read-only answers, reviews, investigations, and
    plans refuse to publish patches.

Diffuin does not have Schedule One or Unity. It must not claim in-game,
Play Mode, Mono runtime, IL2CPP runtime, multiplayer, save/load, or full
end-to-end validation. Its output separates source/static evidence from the
manual runtime checks a maintainer still needs to perform.

The fallback model is `gpt-5.6-luna`. Automatic routing uses
`gpt-5.6-terra` at `medium` or `high` for bounded changes, focused questions,
ordinary reviews, and source-backed technical work. It reserves
`gpt-5.6-luna` at `xhigh` or `max` for genuinely coupled work and unusually
large reviews. The latest request drives the route: a small PR follow-up does
not inherit the full issue or PR's complexity, while broad reviews still account
for the complete diff. Mentions can override both model and reasoning within
deployment-owned allowlists.

Ambiguous middle cases receive a second, bounded routing decision from
`gpt-5.6-luna` at `medium` reasoning. The advisor sees only task metadata,
bounded issue text, diff counts, file names, the deterministic baseline, and
the model allowlist. It runs read-only with network and web search disabled and
returns a closed JSON schema. Explicit overrides, quick reviews, simple focused
requests, disabled routing, and maximum-risk routes skip the advisor. Low
confidence, invalid output, timeouts, and policy violations fall back to the
deterministic route.

Provider selection follows the routed model. The `gpt-5.6-*` models run through
the Codex SDK. Models listed in `SPARK_MODELS` run through the custom Spark
`automation --stdio` protocol; the default Spark model is
`gpt-5.3-codex-spark`. Spark defaults to `medium` reasoning for a better
latency-quality balance. Quick reviews classified as non-trivial or
large/high-risk use at least `high`; an explicit `--effort` override still wins.
Pull-request requests such as `quick review`, `fast PR
review`, `review this quickly`, or `take a quick pass over this` select the
configured Spark model. An explicit `--model` always wins over that shortcut.
Both providers return the same structured artifact and go through the same
secret scan, intent validation, read-only-change guard, and GitHub delivery path.

## GitHub App setup

Create a GitHub App with:

- Webhook URL: `https://YOUR_HOST/webhooks/github`
- Webhook secret: a new random value
- Repository permissions:
  - Contents: Read and write
  - Issues: Read and write
  - Pull requests: Read and write
  - Metadata: Read-only (GitHub adds this automatically)
- Subscribe to events:
  - Issue comment
  - Pull request review comment

Generate a private key and install the App only on repositories you intend to
list in `ALLOWED_REPOSITORIES`.

If a repository ruleset applies required checks to `~ALL` branches, exclude
`refs/heads/diffuin/**` from that rule or grant the Diffuin App a narrowly
scoped bypass. Otherwise GitHub can accept the initial bot branch but reject
follow-up commits because the required check cannot run until the new commit is
first pushed. The target branch and pull-request merge checks remain enforced.

## Configuration

Copy `.env.example` to `.env`. Required values are:

| Variable | Purpose |
| --- | --- |
| `GITHUB_APP_ID` | Numeric GitHub App ID |
| `GITHUB_PRIVATE_KEY_PATH` | Path to a mounted App private-key PEM |
| `GITHUB_PRIVATE_KEY_BASE64` | Hosted alternative to the path; set exactly one private-key option |
| `GITHUB_WEBHOOK_SECRET` | HMAC secret configured on the App |
| `ALLOWED_REPOSITORIES` | Comma-separated `owner/repository` allowlist |
| `CODEX_MODEL` | Fallback model when a routed model is unavailable or automatic routing is disabled |
| `CODEX_ALLOWED_MODELS` | Comma-separated model allowlist for mention overrides |
| `CODEX_REASONING_ROUTING` | Enables automatic reasoning selection; defaults to `true` |
| `CODEX_REASONING_EFFORT` | Fixed fallback used when automatic routing is disabled |
| `ROUTING_ADVISOR_ENABLED` | Enables the bounded Luna routing advisor for ambiguous cases; defaults to `true` |
| `ROUTING_ADVISOR_MODEL` | Internal advisor model; defaults to `gpt-5.6-luna` |
| `ROUTING_ADVISOR_TIMEOUT_MS` | Advisor timeout before deterministic fallback; defaults to 30 seconds |
| `SPARK_COMMAND` | Spark executable name or absolute path; defaults to `spark` |
| `SPARK_MODELS` | Comma-separated models dispatched through Spark; defaults to `gpt-5.3-codex-spark` |
| `SPARK_REASONING_EFFORT` | Default effort for Spark-routed jobs; defaults to `medium` and explicit mention overrides still win |
| `SPARK_TIMEOUT_MS` | Per-run Spark subprocess timeout; defaults to 30 minutes |
| `SPARK_ALLOW_UNSANDBOXED_COMMANDS` | Enables Spark `cmd.exec`; defaults to `false` and requires separate host confinement |
| `SCHEDULE_ONE_SKILL_PATH` | Bundled Schedule One skill directory; defaults to `./skills/schedule-one-modding` |
| `SCHEDULE_ONE_CODE_ARCHIVER_URL` | Runtime source for regular/beta stripped-code references |
| `SCHEDULE_ONE_ASSETRIPPER_PATH` | Optional read-only AssetRipper export mount for local/self-hosted use |

`DIFFUIN_HANDLE`, `DATA_DIR`, the Codex routing settings, the Schedule One
reference settings, and the port have defaults shown in `.env.example`.

The GitHub broker binds only to `127.0.0.1`. The selected harness receives a random session
credential that expires after 30 minutes and is destroyed when the job ends;
it never receives the GitHub App installation token. The broker has no mutation
tools, limits repositories and response sizes, strips search scope qualifiers,
and rejects unmentioned repositories. Arbitrary public GitHub links can be
researched without adding them to `ALLOWED_REPOSITORIES`; that allowlist still
controls where Diffuin accepts mentions and publishes results.

## Run with Docker Compose

Place the downloaded GitHub App key at
`secrets/github-app-private-key.pem`, then run:

```sh
cp .env.example .env
docker compose up -d --build
docker compose exec diffuin codex login --device-auth
```

The device login stores and refreshes ChatGPT-managed Codex credentials in the
persistent `/data/codex-home` volume. Treat that volume like a password.

The Docker image downloads the pinned Spark 0.9.1 Linux release and verifies its
published SHA-256 before installation. It reserves `/data/spark-data` as
Spark's persistent XDG data directory. When Spark has no dedicated saved login,
Diffuin points it at `/data/codex-home`, allowing Spark to reuse the existing
ChatGPT-managed Codex tokens without placing them in prompts or job artifacts.

Expose port 8787 through an HTTPS reverse proxy and update the GitHub App's
webhook URL. Verify `GET /health` before installing the App.

To enable local AssetRipper evidence, first build a compact search corpus in an
ignored directory. The command retains scenes, prefabs, serialized
configuration, animation/controller data, and every `.meta` file, while
dropping textures, meshes, audio, terrain data, and other large presentation
assets:

```sh
bun run assetripper:prepare -- /absolute/AssetRipper_export/ExportedProject/Assets ./data/assetripper-corpus
```

Mount that corpus outside `/app` and set its container path. Never copy it into
this repository or image:

```yaml
services:
  diffuin:
    environment:
      SCHEDULE_ONE_ASSETRIPPER_PATH: /references/assetripper
    volumes:
      - /absolute/local/AssetRipper_export:/references/assetripper:ro
```

## Hosted deployment

Build from the included `Dockerfile`, expose port `8787`, and attach a
persistent volume at `/data`. Set `GITHUB_PRIVATE_KEY_BASE64` instead of
mounting a PEM when the platform offers encrypted environment secrets but not
file secrets.

After the service is running, open its shell and run:

```sh
codex login --device-auth
```

Complete the displayed device flow in your browser. The `/data` volume must
persist across deployments so Codex can refresh its login, retain the reference
cache, and preserve the job queue.

The persistent volume size applies to `/data`, not automatically to the whole
container filesystem. Northflank also assigns separate ephemeral storage to
each runtime instance; it is wiped when the container restarts and has its own
quota. Diffuin keeps its credentials, SQLite queue, reference cache, and active
workspaces under `DATA_DIR`, so a hosted `DATA_DIR=/data` intentionally counts
all of those against the persistent-volume limit. Workspaces are removed after
each job.

For a private hosted instance, upload only the compact corpus to the persistent
volume; do not upload the raw AssetRipper export. With the Northflank CLI, a
one-time upload to the existing Diffuin service is:

```sh
northflank upload service file \
  --projectId diffuin \
  --service diffuin \
  --localPath ./data/assetripper-corpus/ \
  --remotePath /data/references/assetripper
```

Set `SCHEDULE_ONE_ASSETRIPPER_PATH=/data/references/assetripper` on the service
and redeploy it. Diffuin exposes the corpus to Codex only through a
session-authenticated, read-only MCP broker; it does not add the volume path as
a sandbox write root. Keep enough free volume capacity for `/data/codex-home`,
the SQLite queue, cloned source references, and temporary workspaces.

## Use

Typical review and planning requests are read-only:

```text
@Diffuin review this against the regular and beta game source
@Diffuin polish this issue into an implementation-ready plan
@Diffuin identify the Mono/IL2CPP and save/load risks in this proposal
```

Explicit commands support safe per-request overrides:

```text
@Diffuin review --model gpt-5.6-terra --effort high
@Diffuin quick review
@Diffuin review --model gpt-5.3-codex-spark -- focus on correctness regressions
@Diffuin investigate --model gpt-5.6-luna -- research the likely lifecycle seam
@Diffuin plan --model gpt-5.6-luna --effort xhigh -- focus on persistence and multiplayer authority
```

Supported commands are `review`, `investigate`, `plan`, `implement`, and
`answer`. Use `--` before free-form instructions when options are present.
Supported reasoning levels are `minimal`, `low`, `medium`, `high`, `xhigh`,
and `max`. Invalid or disallowed overrides are rejected before a job is queued.
For free-form mentions, Diffuin resolves clear requested deliverables before the
run. In compound requests, implementation takes precedence over planning, and
planning takes precedence over review or investigation. Ambiguous wording is
left for the agent to interpret from the full request and repository context.

Implementation remains explicit:

```text
@Diffuin fix the null dereference and add a regression test
@Diffuin Open a PR against stable to fix the persistence issue
@Diffuin move the validation helper beside the other test utilities
@Diffuin How does the compatibility fallback work in this PR?
```

Diffuin reacts with eyes when the request is queued. It comments with the review
or plan when no files changed, and posts a pull-request URL when an explicit
implementation request produced a patch. Reviews and plans use bounded,
structured sections instead of slicing long Markdown. Every delivered artifact
ends with an AI-generated accuracy notice and includes collapsed provider,
model, reasoning, elapsed-time, and provider-run metadata.

Issue plans include an unchecked action at the end. A repository maintainer can
check it to ask Diffuin to implement that exact plan, open a pull request, and
close the issue when the pull request merges. Each plan comment can trigger at
most one implementation job; a failed run can still be retried with an explicit
`@Diffuin implement` mention.

Diffuin includes recent issue or PR conversation in each job. Follow-up
implementation requests therefore reuse earlier research instead of starting a
new, potentially contradictory diagnosis. Clear natural-language deliverables
are enforced by the application; the agent interprets only requests that remain
ambiguous after that classification.

On a pull request created by Diffuin, a direct request such as
`@Diffuin remove the unused compatibility shim from this PR` commits and pushes
the change back to that pull request's `diffuin/*` branch. Implementation
requests on branches not owned by Diffuin continue to open a separate follow-up
pull request instead of writing directly to a maintainer's branch.

For read-only issue workflows, Diffuin may polish a materially basic issue title
and description while preserving reporter facts and uncertainty. Already
actionable reports are left unchanged.

## Development

```sh
bun install
bun run typecheck
bun run test
bun run build
```

The application runtime is Node.js 24 because that is the supported server-side
runtime for the Codex SDK. Bun is used for package management and scripts. The
Spark integration is a subprocess provider for the versioned
`spark.automation.v1` protocol exposed by `spark automation --stdio`.

## Security and game-artifact boundary

OpenAI recommends API keys as the default for automation and warns that
ChatGPT-managed authentication should not be used for arbitrary public or
open-source repository runners. Diffuin's subscription-auth path is intended
for a trusted operator, an explicit repository allowlist, and trusted
write-authorized requesters. See [SECURITY.md](SECURITY.md) before deploying.

The bundled skill contains guidance only. Stripped source is cloned into the
persistent runtime reference cache and AssetRipper is an optional external
mount. Do not commit, package, attach, or redistribute decompiled game code,
assemblies, generated wrappers, AssetRipper exports, prefabs, scenes, textures,
or other proprietary game artifacts.

## License

Diffuin is licensed under the MIT License. Although it was created for my
personal workflow rather than as a product intended for general adoption, the
license permits anyone to use, copy, modify, distribute, and adapt it subject
to the license terms.
