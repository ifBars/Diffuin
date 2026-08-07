# Security

## Reporting

Please report suspected vulnerabilities privately through GitHub's private
vulnerability reporting feature. Do not include live credentials in reports.

## Trust model

Diffuin is designed for a private, operator-controlled deployment. It accepts
work only for explicitly allowlisted repositories and only from actors with
`write`, `maintain`, or `admin` permission.

Codex receives a fresh checkout with network access disabled and no GitHub App
token in its environment. The target checkout is the only writable workspace.
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
