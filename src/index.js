#!/usr/bin/env node
/**
 * mcp-unhrdb — stdio entry point (Claude Code / Claude Desktop).
 *
 * Spawns the server over stdin/stdout. Tool definitions + API client live in
 * ./server.js; the HTTP entry point (./http.js) shares them. Diagnostics go
 * to stderr so they don't corrupt the stdio JSON-RPC stream.
 *
 * Config (env): see ./server.js.
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { buildServer, config } from './server.js';

const server = buildServer();
const transport = new StdioServerTransport();
await server.connect(transport);
console.error(
  `mcp-unhrdb (stdio) ready · API ${config.API_BASE} · key ${config.API_KEY ? 'set' : 'none'} · ` +
  `TLS ${config.INSECURE_TLS ? 'insecure (self-signed OK)' : 'verified'}`
);
