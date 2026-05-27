/**
 * mcp-unhrdb shared server factory.
 *
 * Builds an McpServer with the two UNHRDB tools and the API client. Used by
 * both entry points:
 *   - src/index.js  stdio  (Claude Code / Claude Desktop)
 *   - src/http.js   HTTP   (remote: Cowork, claude.ai, registry)
 *
 * Config (env):
 *   UNHRDB_API_BASE     default https://150.254.115.204/unhrdb-api/api
 *   UNHRDB_API_KEY      optional token sent as X-API-Key to the API
 *   UNHRDB_INSECURE_TLS "1" (default) accepts the VM's self-signed cert
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import https from 'node:https';
import http from 'node:http';

const API_BASE = (process.env.UNHRDB_API_BASE || 'https://150.254.115.204/unhrdb-api/api').replace(/\/$/, '');
const API_KEY = process.env.UNHRDB_API_KEY || '';
const INSECURE_TLS = (process.env.UNHRDB_INSECURE_TLS ?? '1') === '1';

export const config = { API_BASE, API_KEY, INSECURE_TLS };

// The VM serves the API behind a self-signed cert. Scope the relaxed TLS to
// an explicit agent rather than the global NODE_TLS_REJECT_UNAUTHORIZED so we
// don't weaken TLS for any other request this process might make.
const httpsAgent = new https.Agent({ rejectUnauthorized: !INSECURE_TLS });

// Use node:http(s) directly rather than global fetch: native fetch (undici)
// ignores a custom `agent`, so the self-signed-cert bypass would not apply.
function apiGet(path, params = {}) {
  const url = new URL(API_BASE + path);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  }
  const isHttps = url.protocol === 'https:';
  const lib = isHttps ? https : http;
  const headers = { accept: 'application/json' };
  if (API_KEY) headers['x-api-key'] = API_KEY;
  const opts = { headers };
  if (isHttps) opts.agent = httpsAgent;
  return new Promise((resolve, reject) => {
    const req = lib.get(url, opts, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(new Error(`UNHRDB API ${res.statusCode} for ${url.pathname}${url.search}`));
        }
        try { resolve(JSON.parse(body)); }
        catch (e) { reject(new Error(`Bad JSON from ${url.pathname}: ${e.message}`)); }
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => req.destroy(new Error('UNHRDB API request timed out (15s)')));
  });
}

// "CRC/C/GC/25" -> "crc-c-gc-25"  ·  "CEDAW/C/GC/30/Add.1" -> "cedaw-c-gc-30-add-1"
function signatureToDocId(sig) {
  return sig.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

// Split "CRC/C/GC/25 ¶12" / "A/HRC/61/42 para 10" / "E/C.12/GC/27, para. 4"
// into { signature, paraNumber }. paraNumber may be undefined.
function parseCitation(raw) {
  const text = raw.trim();
  const m = text.match(/[¶§]\s*([0-9]+[a-z]?)\s*$|\b(?:para(?:graph)?\.?|paras?\.?)\s*([0-9]+[a-z]?)\s*$/i);
  let paraNumber, signature;
  if (m) {
    paraNumber = (m[1] || m[2]).trim();
    signature = text.slice(0, m.index).replace(/[,;\s]+$/, '').trim();
  } else {
    signature = text;
  }
  return { signature, paraNumber };
}

function formatHit(h) {
  const sig = h.signature || h.doc_id;
  const where = [h.committee, h.year].filter(Boolean).join(' · ');
  const num = h.n ? `¶${h.n}` : `#${h.idx}`;
  return `${sig} ${num}${where ? ` (${where})` : ''}\n${h.text}\n[para_id: ${h.para_id} · doc_id: ${h.doc_id}]`;
}

// Build a fresh McpServer with both tools registered. A new instance per
// call keeps the HTTP transport's stateless mode safe (no shared session).
export function buildServer() {
  const server = new McpServer({ name: 'mcp-unhrdb', version: '0.2.0' });

  server.registerTool(
    'search_paragraphs',
    {
      title: 'Search UN human rights paragraphs',
      description:
        'Full-text search over the UN Human Rights Database — paragraph-level corpus of Treaty Body General Comments (gc), individual-communication jurisprudence (jur), and Special Procedures reports (sp). Returns verbatim paragraphs with their UN signature and paragraph number for citation. Use scope to restrict to one collection.',
      inputSchema: {
        query: z.string().min(1).describe('Search terms, e.g. "adequate housing" or "best interests of the child".'),
        scope: z.enum(['all', 'gc', 'jur', 'sp']).default('all').describe('Collection: gc = General Comments, jur = jurisprudence, sp = Special Procedures, all = everything.'),
        committee: z.string().optional().describe('Optional committee filter, e.g. "CESCR", "CCPR", "CRC".'),
        year: z.coerce.number().int().optional().describe('Optional exact-year filter, e.g. 2021.'),
        limit: z.coerce.number().int().min(1).max(20).default(10).describe('Max paragraphs to return (1–20).'),
        page: z.coerce.number().int().min(1).default(1).describe('Page of results (server pages are 20 wide).'),
      },
    },
    async ({ query, scope, committee, year, limit, page }) => {
      const data = await apiGet('/search', { q: query, scope, committee, year, page });
      const hits = (data.hits || []).slice(0, limit);
      const header =
        `${data.total} match${data.total === 1 ? '' : 'es'} for "${query}" (scope: ${scope})` +
        (data.breakdown ? ` — gc ${data.breakdown.gc}, jur ${data.breakdown.jur}, sp ${data.breakdown.sp}` : '') +
        `\nShowing ${hits.length} (page ${data.page}).`;
      const body = hits.length ? hits.map(formatHit).join('\n\n') : 'No paragraphs matched.';
      return { content: [{ type: 'text', text: `${header}\n\n${body}` }] };
    }
  );

  server.registerTool(
    'lookup_by_citation',
    {
      title: 'Resolve a UN citation to its paragraph',
      description:
        'Resolve a UN document citation to its verbatim paragraph(s). Accepts a signature with an optional paragraph number, e.g. "CRC/C/GC/25 ¶12", "A/HRC/61/42 para 10", or just "CEDAW/C/GC/30" for document metadata. Matches on the printed paragraph number (¶), not internal index.',
      inputSchema: {
        citation: z.string().min(1).describe('A UN citation, e.g. "CRC/C/GC/25 ¶12" or "ICCPR GC34 para 22".'),
      },
    },
    async ({ citation }) => {
      const { signature, paraNumber } = parseCitation(citation);
      const docId = signatureToDocId(signature);
      let doc;
      try {
        doc = await apiGet(`/document/${encodeURIComponent(docId)}`);
      } catch (e) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Could not resolve "${signature}" (tried doc_id "${docId}"): ${e.message}` }],
        };
      }
      const d = doc.document || {};
      const sig = d.signature || signature;
      const meta = [d.committee, d.year].filter(Boolean).join(' · ');
      const title = d.name_short || d.name || '';

      if (!paraNumber) {
        const count = (doc.paragraphs || []).length;
        const labels = (doc.labels || []).join(', ');
        return {
          content: [{
            type: 'text',
            text: `${sig} — ${title}${meta ? ` (${meta})` : ''}\n${count} paragraph${count === 1 ? '' : 's'}.` +
              (labels ? `\nLabels: ${labels}` : '') +
              (d.link ? `\nSource: ${d.link}` : '') +
              `\n\n(Add a paragraph number to retrieve text, e.g. "${sig} ¶1".)`,
          }],
        };
      }

      const want = paraNumber.toLowerCase();
      const para =
        (doc.paragraphs || []).find(p => String(p.n).toLowerCase() === want) ||
        (doc.paragraphs || []).find(p => String(p.idx) === want);

      if (!para) {
        return {
          isError: true,
          content: [{ type: 'text', text: `${sig} resolved, but no paragraph numbered "${paraNumber}" was found (document has ${doc.paragraphs?.length ?? 0} paragraphs).` }],
        };
      }
      return {
        content: [{
          type: 'text',
          text: `${sig} ¶${para.n}${meta ? ` (${meta})` : ''}` +
            (para.section ? `\nSection: ${para.section}` : '') +
            `\n\n${para.text}\n\n[para_id: ${para.para_id}]` +
            (d.link ? `\nSource: ${d.link}` : ''),
        }],
      };
    }
  );

  return server;
}
