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
  res.json({ status: 'ok', server: 'mcp-unhrdb', transport: 'streamable-http', paragraphsApi: config.API_BASE, recommendationsApi: config.UHRI_API_BASE });
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
app.delete('/mcp', methodNotAllowed);

// A person who pastes the connector address into a browser sends GET with
// Accept: text/html. Until now they got the JSON-RPC 405 above — correct per
// the Streamable HTTP spec (a server with no GET stream MUST answer 405), but
// to the lawyer checking whether the link "works" it read as broken. Serve
// them a short page instead. MCP clients never ask for text/html, so they
// still get the 405 the spec requires.
const GUIDE_URL = process.env.MCP_GUIDE_URL
  || 'https://lszoszk.github.io/UnitedNations_recommendations/ai.html';
const wantsHtml = (req) => String(req.headers.accept || '').includes('text/html');
const noticeHtml = (endpoint) => `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>UHRI+ connector for AI assistants</title>
<style>body{margin:0;background:#F2EFE8;color:#0F0F10;font:15px/1.6 ui-monospace,Menlo,monospace;border-top:6px solid #9b2f22}
main{max-width:640px;margin:0 auto;padding:48px 24px}h1{font:400 34px/1.1 "Instrument Serif","Times New Roman",serif;margin:0 0 16px}
p{color:#3A3934;margin:0 0 14px}code{display:block;background:#EAE6DD;border:1px solid rgba(15,15,16,.14);padding:10px 12px;word-break:break-all;user-select:all}
a{color:#9b2f22}.ok{color:#2a7a3b}</style></head><body><main>
<h1>This address is a connector for AI assistants, not a web page.</h1>
<p><span class="ok">&#10003; The connector is running.</span> Nothing is wrong — browsers just cannot talk to it. AI assistants can.</p>
<p>To use it, add the address below as a <b>custom connector</b> in Claude or ChatGPT, or in Claude Code with
<code>claude mcp add --transport http unhrdb ${endpoint} --scope user</code></p>
<code>${endpoint}</code>
<p>Step-by-step for each app, and a page you can hand to your assistant so it does the connecting:<br>
<a href="${GUIDE_URL}">${GUIDE_URL.replace(/^https?:\/\//, '')}</a></p>
<p>What it gives the assistant: five read-only tools over UN human-rights texts — search and look up more than 270,000
recommendations to States (UHRI), and paragraph-level search over General Comments, jurisprudence and Special Procedures reports —
always verbatim, with the UN document symbol. Free, no account. Source: <a href="https://github.com/lszoszk/mcp-unhrdb">github.com/lszoszk/mcp-unhrdb</a>.</p>
</main></body></html>`;
app.get(['/', '/mcp'], (req, res) => {
  if (!wantsHtml(req)) return methodNotAllowed(req, res);
  // Reconstruct the public address from the proxy headers nginx sets, falling
  // back to the request itself, so the page shows the URL the user pasted.
  const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'https').split(',')[0];
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0];
  const prefix = String(req.headers['x-forwarded-prefix'] || process.env.MCP_PUBLIC_PREFIX || '/unhrdb-mcp-rpc').replace(/\/$/, '');
  const endpoint = host ? `${proto}://${host}${prefix}/mcp` : `${prefix}/mcp`;
  res.type('html').send(noticeHtml(endpoint));
});

app.listen(PORT, HOST, () => {
  console.error(
    `mcp-unhrdb (http) listening on http://${HOST}:${PORT}/mcp · paragraphs ${config.API_BASE} · ` +
    `recommendations ${config.UHRI_API_BASE} · auth ${AUTH_TOKEN ? 'token-gated' : 'open (gate at proxy)'}`
  );
});
