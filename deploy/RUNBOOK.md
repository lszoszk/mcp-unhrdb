# Hardening runbook — token-gated, independently throttled MCP route

Adds a `/unhrdb-mcp/` nginx route that proxies to the same API upstream
(`:8002`) as the dashboard, but is **gated by an X-API-Key token** and has
its **own `limit_req` zone** — so MCP traffic is throttled and revocable
without touching the dashboard route or the FastAPI app/container.

Requires sudo on the VM (nginx config is root-owned). The API app is NOT
modified and NOT restarted.

## 0. Generate a token

```bash
python3 -c "import secrets; print(secrets.token_hex(24))"
```

Use this value everywhere `YOUR_MCP_TOKEN_HERE` appears below (in
`deploy/unhrdb-mcp.location.conf` and in the client `env`). Keep it secret —
it is the credential that authorises MCP traffic.

## 1. Copy the snippets to the VM (no sudo)

From this folder on the laptop:

```bash
scp deploy/mcp_ratelimit.conf <user>@<your-vm-host>:/tmp/mcp_ratelimit.conf
```

## 2. Install the rate-limit zone + token map (sudo)

```bash
ssh <user>@<your-vm-host>
sudo cp /tmp/mcp_ratelimit.conf /etc/nginx/conf.d/mcp_ratelimit.conf
```

## 3. Add the location block (sudo)

```bash
sudo cp /etc/nginx/sites-enabled/default /etc/nginx/sites-enabled/default.bak-mcp-$(date +%Y%m%d-%H%M%S)
sudoedit /etc/nginx/sites-enabled/default   # or: sudo nano …
```

Paste the block from `deploy/unhrdb-mcp.location.conf` directly **after the
closing `}` of `location /unhrdb-api/ { … }`** (around line 191), inside the
same `server { listen 443 ssl … }` block.

## 4. Validate and reload (sudo)

```bash
sudo nginx -t          # MUST print "syntax is ok" + "test is successful"
sudo systemctl reload nginx
```

If `nginx -t` fails, DO NOT reload. Restore: `sudo cp /etc/nginx/sites-enabled/default.bak-mcp-* /etc/nginx/sites-enabled/default`

## 5. Verify

```bash
# No / wrong key -> 401
curl -sk -o /dev/null -w "%{http_code}\n" "https://<your-host>/unhrdb-mcp/api/stats"
# With key -> 200
curl -sk -H "X-API-Key: YOUR_MCP_TOKEN_HERE" \
  -o /dev/null -w "%{http_code}\n" "https://<your-host>/unhrdb-mcp/api/stats"
```

## 6. Point the MCP server at the hardened route

In `claude_desktop_config.json`, add `env` to the unhrdb server:

```json
"unhrdb": {
  "command": "node",
  "args": ["/ABSOLUTE/PATH/TO/mcp-unhrdb/src/index.js"],
  "env": {
    "UNHRDB_API_BASE": "https://<your-host>/unhrdb-mcp/api",
    "UNHRDB_API_KEY": "YOUR_MCP_TOKEN_HERE"
  }
}
```

Restart Claude Desktop.

## Operations

- **Revoke / rotate**: edit the `if ($http_x_api_key != "…")` token string in
  the `/unhrdb-mcp/` location block in `/etc/nginx/sites-enabled/default`,
  `sudo nginx -t && sudo systemctl reload nginx`. For rotation also update the
  client `env` and restart Desktop. New token: `python3 -c "import secrets;print(secrets.token_hex(24))"`.
- **Throttle**: change `rate=60r/m` (zone, in conf.d) and/or `burst=20`
  (location), reload.
- **Multiple tokens**: switch the `if` gate to a `map $http_x_api_key …` in
  the conf.d file and add `map_hash_bucket_size 128;` (long token keys
  overflow the default 64-byte bucket).

## Note (pre-existing, not changed here)

The FastAPI app's own `slowapi` limit (`/api/search` = 120/min) keys on
`get_remote_address`, which behind nginx is `127.0.0.1` for every request —
so that app-level limit is effectively a shared global bucket across all
routes. The nginx `limit_req` zones (ask_api, mcp_api) are the real per-client
throttles. Worth fixing separately by having slowapi trust `X-Forwarded-For`,
but out of scope for this change.
