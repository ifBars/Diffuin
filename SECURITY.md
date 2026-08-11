# Security

## Reporting

Please report suspected vulnerabilities privately through GitHub's private
vulnerability reporting feature. Do not include live credentials in reports.

## Trust model

Diffuin is designed for a private, operator-controlled deployment. It accepts
work only for explicitly allowlisted repositories and only from actors with
`write`, `maintain`, or `admin` permission.

Codex receives a fresh checkout with network access disabled and no GitHub App
token in its environment. Spark receives the same checkout, explicit read roots,
structured-output contract, and only short-lived broker credentials; it never
receives the GitHub App installation token. The target checkout is the only
writable workspace.
The Spark host process may read ChatGPT tokens from the operator-controlled
`CODEX_HOME` when no separate Spark login exists. Those tokens remain harness
credentials: they are not added to prompts, MCP configuration, logs, or output
artifacts.
The bundled Schedule One skill, runtime-cloned CodeArchiver source, and optional
externally mounted AssetRipper export remain outside that writable checkout.
Diffuin inspects the generated patch for common credential formats before it
commits or publishes anything. Changes are always delivered through a pull
request.

The CodeArchiver URL is an operator-controlled trust input and is refreshed by
the worker before Codex starts. AssetRipper exports must be mounted read-only
and must never be copied into the image, target checkout, or published output.

This is defense in depth, not a security boundary suitable for arbitrary
untrusted code. ChatGPT-managed Codex authentication is an advanced trusted
runner configuration. Do not install a subscription-authenticated deployment
on arbitrary public repositories or allow untrusted users to trigger it.

Spark's `cmd.exec` tool is not an OS sandbox. Diffuin therefore leaves it
disabled unless `SPARK_ALLOW_UNSANDBOXED_COMMANDS=true`. Do not enable that
setting merely to run repository checks: first confine command execution with a
separate container or equivalent host boundary that prevents filesystem and
network escape. Spark supports routing commands through a preconfigured Docker
container with `SPARK_CMD_EXEC_DOCKER_CONTAINER` and
`SPARK_CMD_EXEC_DOCKER_WORKDIR`; Diffuin forwards only those sandbox settings.
Workspace edits, read-only reference access, and the scoped MCP brokers remain
available without command execution.
