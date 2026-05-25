// Smoke test: spawn the server over stdio, list tools, call both.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const transport = new StdioClientTransport({ command: 'node', args: ['src/index.js'] });
const client = new Client({ name: 'smoke', version: '0.0.0' });
await client.connect(transport);

const tools = await client.listTools();
console.log('TOOLS:', tools.tools.map(t => t.name).join(', '));

const s = await client.callTool({ name: 'search_paragraphs', arguments: { query: 'best interests of the child digital', scope: 'gc', limit: 2 } });
console.log('\n--- search_paragraphs ---\n' + s.content[0].text.slice(0, 700));

const c = await client.callTool({ name: 'lookup_by_citation', arguments: { citation: 'CRC/C/GC/25 ¶12' } });
console.log('\n--- lookup_by_citation ---\n' + c.content[0].text.slice(0, 700));

const c2 = await client.callTool({ name: 'lookup_by_citation', arguments: { citation: 'A/HRC/61/42 para 10' } });
console.log('\n--- lookup (SP, ¶10) ---\n' + c2.content[0].text.slice(0, 300));

const c3 = await client.callTool({ name: 'lookup_by_citation', arguments: { citation: 'CEDAW/C/GC/30' } });
console.log('\n--- lookup (doc only) ---\n' + c3.content[0].text.slice(0, 400));

await client.close();
process.exit(0);
