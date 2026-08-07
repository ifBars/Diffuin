# Diffuin

Diffuin is a small, self-hosted GitHub App that turns an `@Diffuin` mention into
a Codex implementation job. It clones the repository into a fresh workspace,
asks Codex to make and check the requested change, then pushes the result to a
bot branch and opens a pull request.

It is intentionally generic: Codex is told to follow each repository's own
`AGENTS.md`, contributing guide, and coding standards where applicable.

## What it does

1. Verifies the GitHub webhook signature.
2. Accepts new issue comments and pull-request review comments containing the
   configured mention.
3. Requires the repository to be allowlisted and the requesting actor to have
   write-equivalent permission.
4. Queues the delivery idempotently in SQLite.
5. Runs Codex in a fresh checkout with `workspace-write`, no approvals, and no
   network access.
6. scans the response and patch for common secret formats.
7. Opens a pull request instead of writing to the target branch.

The default model is `gpt-5.6-luna` with `max` reasoning, configurable through
environment variables.

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

## Configuration

Copy `.env.example` to `.env`. Required values are:

| Variable | Purpose |
| --- | --- |
| `GITHUB_APP_ID` | Numeric GitHub App ID |
| `GITHUB_PRIVATE_KEY_PATH` | Path to a mounted App private-key PEM |
| `GITHUB_PRIVATE_KEY_BASE64` | Hosted alternative to the path; set exactly one private-key option |
| `GITHUB_WEBHOOK_SECRET` | HMAC secret configured on the App |
| `ALLOWED_REPOSITORIES` | Comma-separated `owner/repository` allowlist |

`DIFFUIN_HANDLE`, `DATA_DIR`, `CODEX_MODEL`, `CODEX_REASONING_EFFORT`, and the
port have safe defaults shown in `.env.example`.

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

Expose port 8787 through an HTTPS reverse proxy and update the GitHub App's
webhook URL. Verify `GET /health` before installing the App.

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
persist across deployments so Codex can refresh its login and the job queue is
not lost.

## Use

On an issue or pull request conversation:

```text
@Diffuin fix the null dereference and add a regression test
```

Diffuin reacts with eyes when the request is queued and comments with the pull
request URL when it finishes.

## Development

```sh
bun install
bun run typecheck
bun run test
bun run build
```

The application runtime is Node.js 24 because that is the supported server-side
runtime for the Codex SDK. Bun is used for package management and scripts.

## Security note

OpenAI recommends API keys as the default for automation and warns that
ChatGPT-managed authentication should not be used for arbitrary public or
open-source repository runners. Diffuin's subscription-auth path is intended
for a trusted operator, an explicit repository allowlist, and trusted
write-authorized requesters. See [SECURITY.md](SECURITY.md) before deploying.

## License

MIT
