# mcp-unhrdb

[![MCP](https://img.shields.io/badge/MCP-Server-blue)](https://modelcontextprotocol.io) [![Node](https://img.shields.io/badge/Node-18%2B-brightgreen)](https://nodejs.org) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](#license)

Model Context Protocol server for the **UN Human Rights Database** — a
paragraph-level corpus of UN Treaty Body General Comments, individual-
communication jurisprudence, and Special Procedures reports (≈203,000
paragraphs across ≈4,900 documents, citable down to the paragraph number).

It runs as a stdio process and is a thin wrapper over the existing UNHRDB
HTTP API: it adds no index of its own, it just re-exposes the live search
backend over MCP so any client (Claude Desktop, Claude Code, Cowork) can
query the corpus natively.

Companion to the [UNHRD search interface](https://lszoszk.github.io/generalcomments/).

> **Try it instantly — no token, no deployment.** The server ships pointed at
> the live public API, so `npm install` and the Claude Desktop config below
> are all you need to start querying the corpus. (Self-hosting your own
> token-gated route is optional — see [deploy/RUNBOOK.md](deploy/RUNBOOK.md).)

## Tools

| Tool | Description |
|---|---|
| `search_paragraphs` | Full-text search with `scope` (gc / jur / sp / all), `committee` and `year` filters. Returns verbatim paragraphs with UN signature + ¶ number. |
| `lookup_by_citation` | Resolve a citation such as `CRC/C/GC/25 ¶12` or `A/HRC/61/42 para 10` to its verbatim paragraph. Omit the ¶ number to get document metadata. |

Every result is a **verbatim** UN paragraph with its signature and paragraph
number — no paraphrase, no synthesised text — so answers stay citable to the
original UN document.

## Requirements

- Node.js ≥ 18
- Network access to the UNHRDB API

## Install

```bash
git clone <repo-url> mcp-unhrdb
cd mcp-unhrdb
npm install
```

## Run (standalone test)

```bash
node src/index.js
# listens on stdin/stdout; diagnostics on stderr
```

Or run the end-to-end smoke test (spawns the server, lists tools, calls both):

```bash
node test-smoke.js
```

## Configuration (env)

| Variable | Default | Notes |
|---|---|---|
| `UNHRDB_API_BASE` | `https://150.254.115.204/unhrdb-api/api` | Base URL of the UNHRDB API. Point at `…/unhrdb-mcp/api` to use the token-gated, independently rate-limited route (see [deploy/RUNBOOK.md](deploy/RUNBOOK.md)). |
| `UNHRDB_API_KEY` | _(empty)_ | Optional token sent as the `X-API-Key` header. Required by the hardened `/unhrdb-mcp/` route; ignored by the public `/unhrdb-api/` route. |
| `UNHRDB_INSECURE_TLS` | `1` | `1` accepts the VM's self-signed certificate. Set to `0` once the API is behind a trusted certificate. The relaxed TLS is scoped to this server's own HTTPS agent — it does not weaken TLS globally. |

## Wire into Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "unhrdb": {
      "command": "node",
      "args": ["/Users/lszoszk/Desktop/mcp-unhrdb/src/index.js"]
    }
  }
}
```

Restart Claude Desktop; the two tools appear under the 🔌 menu.

## Notes & limits

- Server-side pages are 20 results wide. `search_paragraphs` returns up to
  `limit` (≤20) from the requested `page`; paginate with `page` for more.
- `lookup_by_citation` matches on the **printed** paragraph number (¶N),
  falling back to internal index, so lettered sub-items resolve correctly.
- This is a **0.1 prototype**: two read-only tools. Candidate next tools:
  `get_document` (full text), `find_related` (embedding neighbours),
  `get_metadata`.

## License

MIT.
