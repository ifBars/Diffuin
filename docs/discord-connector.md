# Discord connector plan

Discord will be Diffuin's second connector. Bot application creation and token
configuration are intentionally deferred until the connector implementation is
ready for operator setup.

## Initial scope

- Allowlisted guilds, channels, roles, and users.
- Mentions plus `/ask`, `/new`, `/skills`, `/status`, and `/stop` commands.
- One durable Diffuin session per Discord thread.
- Read-only answers and repository research by default.
- Progress updates edited into a single status message.
- Explicit repository binding before GitHub evidence is exposed.
- Direct messages disabled by default.

## Authorization boundary

A Discord identity is not a GitHub identity. Discord requests must not create
branches, push commits, open pull requests, or update issues until the user has
completed an explicit identity link and the GitHub connector independently
confirms repository permission for that run.

Channel history, quoted messages, attachments, repository content, and bot
responses are untrusted context. They cannot expand the active allowlist,
enable tools, reveal credentials, or override deployment policy.

## Operator setup later

The setup flow will ask the operator to create a Discord application, add a bot,
enable only the required intents, install it into an allowlisted guild, and
store the token as a secret. The token must never be accepted through a Discord
message, written to a skill, or exposed to the model.
