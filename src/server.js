/**
 * mcp-unhrdb shared server factory.
 *
 * Builds an McpServer with the two UNHRDB tools and the API client. Used by
 * both entry points:
 *   - src/index.js  stdio  (Claude Code / Claude Desktop)
 *   - src/http.js   HTTP   (remote: Cowork, claude.ai, registry)
 *
 * Two corpora, two APIs on the same VM (never blended — each tool hits exactly
 * one backend):
 *   - UNHRDB paragraphs  (search_paragraphs / lookup_by_citation)  -> UNHRDB_API_BASE
 *   - UHRI recommendations (search_recommendations / list_uhri_facets) -> UHRI_API_BASE
 *
 * Config (env):
 *   UNHRDB_API_BASE     default https://150.254.115.204/unhrdb-api/api
 *   UNHRDB_API_KEY      optional token sent as X-API-Key to the UNHRDB API
 *   UHRI_API_BASE       default https://150.254.115.204/uhri-api/api
 *   UHRI_API_KEY        optional token for the UHRI API (public route needs none)
 *   UNHRDB_INSECURE_TLS "1" (default) accepts the VM's self-signed cert
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import https from 'node:https';
import http from 'node:http';
import zlib from 'node:zlib';

const API_BASE = (process.env.UNHRDB_API_BASE || 'https://150.254.115.204/unhrdb-api/api').replace(/\/$/, '');
const API_KEY = process.env.UNHRDB_API_KEY || '';
// UHRI+ recommendations corpus — a *second*, distinct dataset on the same VM
// (the /uhri-api records API). The public route needs no key; server-side Node
// is not CORS-bound, so that API's browser-only ACAO pin is irrelevant here.
const UHRI_API_BASE = (process.env.UHRI_API_BASE || 'https://150.254.115.204/uhri-api/api').replace(/\/$/, '');
const UHRI_API_KEY = process.env.UHRI_API_KEY || '';
const INSECURE_TLS = (process.env.UNHRDB_INSECURE_TLS ?? '1') === '1';

export const config = { API_BASE, API_KEY, UHRI_API_BASE, UHRI_API_KEY, INSECURE_TLS };

// The VM serves the API behind a self-signed cert. Scope the relaxed TLS to
// an explicit agent rather than the global NODE_TLS_REJECT_UNAUTHORIZED so we
// don't weaken TLS for any other request this process might make.
const httpsAgent = new https.Agent({ rejectUnauthorized: !INSECURE_TLS });

// Use node:http(s) directly rather than global fetch: native fetch (undici)
// ignores a custom `agent`, so the self-signed-cert bypass would not apply.
// Generic over `base`/`apiKey` so both corpora share one request path.
function requestJson(base, path, params = {}, apiKey = '') {
  const url = new URL(base + path);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  }
  const isHttps = url.protocol === 'https:';
  const lib = isHttps ? https : http;
  const headers = { accept: 'application/json' };
  if (apiKey) headers['x-api-key'] = apiKey;
  const opts = { headers };
  if (isHttps) opts.agent = httpsAgent;
  return new Promise((resolve, reject) => {
    const req = lib.get(url, opts, (res) => {
      // nginx serves the precomputed/cached endpoints (facets, analytics, map,
      // summary) gzip-encoded regardless of Accept-Encoding, and node:http does
      // not auto-decompress — so decode by Content-Encoding before parsing.
      const enc = String(res.headers['content-encoding'] || '').toLowerCase();
      const stream =
        enc === 'gzip'    ? res.pipe(zlib.createGunzip()) :
        enc === 'deflate' ? res.pipe(zlib.createInflate()) :
        enc === 'br'      ? res.pipe(zlib.createBrotliDecompress()) :
        res;
      const chunks = [];
      stream.on('data', (c) => chunks.push(c));
      stream.on('error', reject);
      stream.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(new Error(`API ${res.statusCode} for ${url.host}${url.pathname}${url.search}`));
        }
        const body = Buffer.concat(chunks).toString('utf8');
        try { resolve(JSON.parse(body)); }
        catch (e) { reject(new Error(`Bad JSON from ${url.pathname}: ${e.message}`)); }
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => req.destroy(new Error('API request timed out (15s)')));
  });
}

// UNHRDB paragraph corpus (Treaty Body General Comments / jurisprudence / SP).
const apiGet = (path, params) => requestJson(API_BASE, path, params, API_KEY);
// UHRI+ recommendations corpus.
const uhriGet = (path, params) => requestJson(UHRI_API_BASE, path, params, UHRI_API_KEY);

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

// The UHRI export carries a leading "- " artefact on Body / AnnotationType
// (and in the bodies facet) — strip it for display and de-dup.
const _deprefix = (s) => String(s || '').replace(/^[-\s]+/, '').trim();

// One UHRI recommendation, verbatim, with citation metadata.
function formatRec(r) {
  const sym = r.Symbol || '(no UN document symbol)';
  const where = [_deprefix(r.Body), (r.Countries || [])[0], (r.PublicationDate || '').slice(0, 4)]
    .filter(Boolean).join(' · ');
  const type = _deprefix(r.AnnotationType);
  const text = (r.TextPlainCleaned || r.Text || '').trim();
  const themes = (r.Themes || []).slice(0, 4).join('; ');
  return `${sym}${where ? ` (${where})` : ''}${type ? ` — ${type}` : ''}\n${text}` +
    (themes ? `\nThemes: ${themes}` : '') +
    `\n[annotation_id: ${r.AnnotationId}]`;
}

// Build a fresh McpServer with both tools registered. A new instance per
// call keeps the HTTP transport's stateless mode safe (no shared session).
export function buildServer() {
  const server = new McpServer({ name: 'mcp-unhrdb', version: '0.3.0' });

  server.registerTool(
    'search_paragraphs',
    {
      title: 'Search UN human rights paragraphs',
      description:
        'Full-text search over the UN Human Rights Database — paragraph-level corpus of Treaty Body General Comments (gc), individual-communication jurisprudence (jur), and Special Procedures reports (sp). Returns verbatim paragraphs with their UN signature and paragraph number for citation. Use scope to restrict to one collection. This is the treaty-body / expert-commentary corpus; for recommendations and observations addressed to individual States (the separate UHRI dataset), use search_recommendations instead — the two corpora are never combined.',
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

  // ---------------------------------------------------------------------------
  // UHRI recommendations corpus — the second dataset. Distinct backend, distinct
  // tools; a call here never touches the paragraph corpus above.
  // ---------------------------------------------------------------------------

  server.registerTool(
    'search_recommendations',
    {
      title: 'Search UHRI recommendations to States',
      description:
        'Full-text + faceted search over the UHRI dataset — ~267,000 human-rights RECOMMENDATIONS and observations addressed to individual UN Member States by the Universal Periodic Review, Treaty Bodies and Special Procedures (2006–present). Returns each item verbatim with its UN document symbol, issuing body, country, year and annotation_id for citation. This is the State-directed recommendations corpus; for the text of General Comments, individual-communication jurisprudence, or Special Procedures thematic reports, use search_paragraphs instead — the two corpora are never combined. Call list_uhri_facets first for exact country names and body codes.',
      inputSchema: {
        query: z.string().optional().describe('Free-text terms matched against the recommendation text, e.g. "solitary confinement". Optional — omit to browse by filters alone.'),
        countries: z.array(z.string()).optional().describe('Country names as used by the UN, e.g. ["Poland","France"]. Multiple values = OR. See list_uhri_facets.'),
        bodies: z.array(z.string()).optional().describe('Issuing-body codes, e.g. ["CAT","CCPR","UPR","CEDAW"]. Multiple = OR. See list_uhri_facets.'),
        themes: z.array(z.string()).optional().describe('Exact (long, human-readable) theme labels. Multiple = OR. Read valid labels off a first unfiltered result.'),
        affected_persons: z.array(z.string()).optional().describe('Concerned/affected-group labels, e.g. ["Women & girls","Children"]. Multiple = OR.'),
        sdgs: z.array(z.string()).optional().describe('Sustainable Development Goal labels or numbers. Multiple = OR.'),
        annotation_type: z.string().optional().describe('Item type, typically "Recommendations" or "Observations". Omit for all types.'),
        year_start: z.coerce.number().int().optional().describe('Earliest publication year, inclusive (e.g. 2015).'),
        year_end: z.coerce.number().int().optional().describe('Latest publication year, inclusive.'),
        limit: z.coerce.number().int().min(1).max(20).default(10).describe('Max recommendations to return (1–20).'),
        page: z.coerce.number().int().min(1).default(1).describe('Page of results.'),
      },
    },
    async ({ query, countries, bodies, themes, affected_persons, sdgs, annotation_type, year_start, year_end, limit, page }) => {
      // Separators mirror the live dashboard's buildParams: comma for
      // countries/bodies/type, pipe for themes/affected_persons/sdgs (their
      // labels contain commas). The API normalises the "- " body prefix itself.
      const data = await uhriGet('/data/records', {
        text_query: query,
        countries: (countries || []).join(','),
        bodies: (bodies || []).join(','),
        themes: (themes || []).join('|'),
        affected_persons: (affected_persons || []).join('|'),
        sdgs: (sdgs || []).join('|'),
        annotation_type,
        year_start,
        year_end,
        page,
        page_size: limit,
        sort_by: 'publication_date',
        sort_dir: 'desc',
      });
      const recs = data.records || [];
      const applied = [
        countries?.length && `countries: ${countries.join(', ')}`,
        bodies?.length && `bodies: ${bodies.join(', ')}`,
        annotation_type && `type: ${annotation_type}`,
        (year_start || year_end) && `years: ${year_start || '…'}–${year_end || '…'}`,
      ].filter(Boolean).join(' · ');
      const total = data.total_records ?? 0;
      const header =
        `${total.toLocaleString('en-US')} recommendation${total === 1 ? '' : 's'}` +
        (query ? ` for "${query}"` : '') + (applied ? ` (${applied})` : '') +
        `\nShowing ${recs.length} (page ${data.page} of ${data.total_pages ?? 1}).`;
      const body = recs.length ? recs.map(formatRec).join('\n\n') : 'No recommendations matched these filters.';
      return { content: [{ type: 'text', text: `${header}\n\n${body}` }] };
    }
  );

  server.registerTool(
    'list_uhri_facets',
    {
      title: 'List UHRI filter values',
      description:
        'List the valid filter values for search_recommendations — the country names, issuing-body codes, region groups, annotation types and year span in the UHRI recommendations dataset. Call this when you need exact country/body spellings before filtering. This describes the recommendations corpus only, not the paragraph corpus (search_paragraphs).',
      inputSchema: {
        kind: z.enum(['all', 'countries', 'bodies', 'regions', 'types']).default('all').describe('Which facet to list; "all" returns a compact summary of each (countries listed on request).'),
      },
    },
    async ({ kind }) => {
      const f = await uhriGet('/data/facets', {});
      // De-prefix, de-dup, and drop internal UUID artefacts that leak into the
      // facet lists (a few appear under `types`) so agents never see them as
      // selectable filter values.
      const _isUuid = (s) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
      const clean = (arr) => [...new Set((arr || []).map(_deprefix).filter((s) => s && !_isUuid(s)))].sort();
      const countries = clean(f.countries), bodies = clean(f.bodies), regions = clean(f.regions), types = clean(f.types);
      const list = (label, arr) => `${label} (${arr.length}): ${arr.join(', ')}`;
      let text;
      if (kind === 'countries') text = list('Countries', countries);
      else if (kind === 'bodies') text = list('Bodies', bodies);
      else if (kind === 'regions') text = list('Regions', regions);
      else if (kind === 'types') text = list('Annotation types', types);
      else text =
        `UHRI dataset — ${(f.total_records ?? 0).toLocaleString('en-US')} recommendations, ${f.min_year}–${f.max_year}.\n\n` +
        `${list('Bodies', bodies)}\n\n${list('Regions', regions)}\n\n${list('Annotation types', types)}\n\n` +
        `Countries: ${countries.length} — call list_uhri_facets with kind="countries" for the full list.\n` +
        `Themes, affected_persons and SDGs are long free-text labels; pass exact strings to search_recommendations.`;
      return { content: [{ type: 'text', text }] };
    }
  );

  return server;
}
