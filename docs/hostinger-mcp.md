# Hostinger MCP Setup

The project-level [`.mcp.json`](../.mcp.json) configures six Hostinger MCP servers
(hosting, domains, DNS, billing, reach, VPS) from the official
[`hostinger-api-mcp`](https://www.npmjs.com/package/hostinger-api-mcp) package.
Claude Code loads this file automatically when a session starts in this repository.

## Requirements

- Node.js 20+ (the servers run via `npx`)
- A Hostinger API token, exported as an environment variable:

```sh
export HOSTINGER_API_TOKEN="<your-token>"
```

The token is **not** stored in the repository — `.mcp.json` references it via
`${HOSTINGER_API_TOKEN}` env expansion. Generate a token in hPanel under
**Account → API**. If a token is ever pasted into a chat, log, or commit, revoke
it and generate a new one.

## Usage

1. Set `HOSTINGER_API_TOKEN` in the shell (or in your Claude Code environment
   settings for remote/web sessions).
2. Start a Claude Code session in the repo root and approve the project MCP
   servers when prompted (`/mcp` shows their status).

Note for Claude Code on the web: the servers make outbound calls to
`developers.hostinger.com`, so the environment's network policy must allow that
host.
