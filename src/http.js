#!/usr/bin/env node
/**
 * mcp-unhrdb — HTTP (Streamable HTTP) entry point.
 *
 * Serves the same two tools as the stdio entry over MCP's Streamable HTTP
 * transport, so remote clients (Claude Cowork, claude.ai, the connector
 * registry) can reach it at a URL. Runs stateless: a fresh server + transport
 * per request, which is safe because the tools hold no session state.
 *
 * Intended to run on the VM behind nginx (TLS + optional token gate), the
 * same pattern as the dashboard's /unhrdb-api/ and the hardened /unhrdb-mcp/
 * routes. Set UNHRDB_API_BASE to the local API (http://127.0.0.1:8002/api)
 * when co-located, so no TLS/token round-trip is needed internally.
 *
 * Config (env):
 *   PORT            listen port              (default 8004)
 *   HOST            bind address             (default 127.0.0.1)
 *   MCP_AUTH_TOKEN  optional bearer token. When set, requests must send
 *                   `Authorization: Bearer <token>` or `X-API-Key: <token>`.
 *                   Leave unset if a fronting proxy (nginx) does the gating.
 *   plus the API_* vars consumed by ./server.js
 */
import express from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { buildServer, config } from './server.js';

const PORT = Number(process.env.PORT || 8004);
const HOST = process.env.HOST || '127.0.0.1';
const AUTH_TOKEN = process.env.MCP_AUTH_TOKEN || '';

const app = express();
app.use(express.json({ limit: '1mb' }));

// Liveness probe (used by docker / nginx). No auth.
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', server: 'mcp-unhrdb', transport: 'streamable-http', api: config.API_BASE });
});

// Optional bearer/X-API-Key gate. A no-op when MCP_AUTH_TOKEN is unset
// (e.g. when nginx already gates the route).
function authorized(req) {
  if (!AUTH_TOKEN) return true;
  const auth = req.headers['authorization'];
  if (typeof auth === 'string' && auth.replace(/^Bearer\s+/i, '').trim() === AUTH_TOKEN) return true;
  if (req.headers['x-api-key'] === AUTH_TOKEN) return true;
  return false;
}

const jsonRpcError = (res, status, code, message) =>
  res.status(status).json({ jsonrpc: '2.0', error: { code, message }, id: null });

// Single MCP endpoint. Stateless: build a fresh server + transport per POST.
app.post('/mcp', async (req, res) => {
  if (!authorized(req)) return jsonRpcError(res, 401, -32001, 'Unauthorized');
  try {
    const server = buildServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => { transport.close(); server.close(); });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error('[mcp-http] request error:', err);
    if (!res.headersSent) jsonRpcError(res, 500, -32603, 'Internal server error');
  }
});

// Stateless mode has no long-lived stream to resume or terminate.
const methodNotAllowed = (_req, res) =>
  jsonRpcError(res, 405, -32000, 'Method not allowed (stateless server: use POST /mcp).');
app.get('/mcp', methodNotAllowed);
app.delete('/mcp', methodNotAllowed);

app.listen(PORT, HOST, () => {
  console.error(
    `mcp-unhrdb (http) listening on http://${HOST}:${PORT}/mcp · API ${config.API_BASE} · ` +
    `auth ${AUTH_TOKEN ? 'token-gated' : 'open (gate at proxy)'}`
  );
});
