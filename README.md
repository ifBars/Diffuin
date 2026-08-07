# Diffuin

Diffuin is a small, self-hosted GitHub App for Schedule One mod repositories.
An `@Diffuin` mention asks Codex to review a pull request against game source,
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
instance may also mount an AssetRipper export read-only.

## What it does

1. Verifies the GitHub webhook signature.
2. Accepts new issue comments and pull-request review comments containing the
   configured mention.
3. Requires the repository to be allowlisted and the requesting actor to have
   write-equivalent permission.
4. Queues the delivery idempotently in SQLite.
5. Refreshes regular (`alternate`) and beta (`alternate-beta`) game-source
   references before starting Codex.
6. Runs Codex in a fresh checkout with `workspace-write`, no approvals, and no
   network access. Reference directories are readable but outside the writable
   checkout.
7. For pull requests, fetches the base branch so Codex can review the complete
   base-to-head diff.
8. Scans the response and patch for common secret formats.
9. Comments with read-only review/planning results, or opens a pull request only
   when an explicitly requested implementation changed files.

Diffuin does not have Schedule One or Unity. It must not claim in-game,
Play Mode, Mono runtime, IL2CPP runtime, multiplayer, save/load, or full
end-to-end validation. Its output separates source/static evidence from the
manual runtime checks a maintainer still needs to perform.

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
| `SCHEDULE_ONE_SKILL_PATH` | Bundled Schedule One skill directory; defaults to `./skills/schedule-one-modding` |
| `SCHEDULE_ONE_CODE_ARCHIVER_URL` | Runtime source for regular/beta stripped-code references |
| `SCHEDULE_ONE_ASSETRIPPER_PATH` | Optional read-only AssetRipper export mount for local/self-hosted use |

`DIFFUIN_HANDLE`, `DATA_DIR`, `CODEX_MODEL`, `CODEX_REASONING_EFFORT`, the
Schedule One reference settings, and the port have defaults shown in
`.env.example`.

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

To enable local AssetRipper evidence, mount the existing export outside `/app`
and set its container path. Never copy it into this repository or image:

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

Do not upload an AssetRipper export to a hosted deployment. The default hosted
configuration uses the runtime-cloned CodeArchiver source plus the bundled
skill, and reports serialized evidence as unavailable.

## Use

Typical review and planning requests are read-only:

```text
@Diffuin review this against the regular and beta game source
@Diffuin polish this issue into an implementation-ready plan
@Diffuin identify the Mono/IL2CPP and save/load risks in this proposal
```

Implementation remains explicit:

```text
@Diffuin fix the null dereference and add a regression test
```

Diffuin reacts with eyes when the request is queued. It comments with the review
or plan when no files changed, and posts a pull-request URL when an explicit
implementation request produced a patch.

## Development

```sh
bun install
bun run typecheck
bun run test
bun run build
```

The application runtime is Node.js 24 because that is the supported server-side
runtime for the Codex SDK. Bun is used for package management and scripts.

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
