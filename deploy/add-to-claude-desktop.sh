#!/usr/bin/env bash
# Adds the `unhrdb` MCP server to claude_desktop_config.json, preserving all
# existing keys.
#
# IMPORTANT: fully QUIT Claude Desktop first (Cmd-Q). The running app
# re-serialises this file and strips unknown top-level keys like
# mcpServers, so edits made while it is open do not persist.
#
# Usage:
#   UNHRDB_API_BASE="https://<host>/unhrdb-mcp/api" \
#   UNHRDB_API_KEY="<your token>" \
#   MCP_SERVER_PATH="/abs/path/to/mcp-unhrdb/src/index.js" \
#   bash deploy/add-to-claude-desktop.sh
#
# UNHRDB_API_BASE / UNHRDB_API_KEY are optional — omit them to use the public
# (non-token) route the server defaults to.
set -euo pipefail

CFG="$HOME/Library/Application Support/Claude/claude_desktop_config.json"
SERVER_PATH="${MCP_SERVER_PATH:-$(cd "$(dirname "$0")/.." && pwd)/src/index.js}"

if pgrep -x "Claude" >/dev/null 2>&1; then
  echo "Claude Desktop appears to be running. Quit it (Cmd-Q) first, then re-run." >&2
  exit 1
fi

CFG="$CFG" SERVER_PATH="$SERVER_PATH" python3 <<'PY'
import json, os

cfg_path = os.environ["CFG"]
cfg = json.load(open(cfg_path)) if os.path.exists(cfg_path) else {}
cfg.setdefault("mcpServers", {})

entry = {"command": "node", "args": [os.environ["SERVER_PATH"]]}
env = {}
if os.environ.get("UNHRDB_API_BASE"):
    env["UNHRDB_API_BASE"] = os.environ["UNHRDB_API_BASE"]
if os.environ.get("UNHRDB_API_KEY"):
    env["UNHRDB_API_KEY"] = os.environ["UNHRDB_API_KEY"]
if env:
    entry["env"] = env

cfg["mcpServers"]["unhrdb"] = entry
json.dump(cfg, open(cfg_path, "w"), indent=2, ensure_ascii=False)
print("Added mcpServers.unhrdb. Now reopen Claude Desktop.")
PY
