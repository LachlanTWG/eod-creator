// List (and optionally delete) pages in the ClickUp meeting doc, to detect
// duplicate weekly meeting pages.
//
// Usage:
//   node src/scripts/meetingPages.js                       list all pages (tree)
//   node src/scripts/meetingPages.js --match "Week of 25 May"   filter by title
//   node src/scripts/meetingPages.js --delete <pageId>     delete one page

require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });
const { listDocPages, clickupRequest } = require('../integrations/clickup');

const args = process.argv.slice(2);
const getArg = (f) => { const i = args.indexOf(f); return i !== -1 ? args[i + 1] : null; };
const match = getArg('--match');
const deleteId = getArg('--delete');

const workspaceId = process.env.CLICKUP_WORKSPACE_ID;
const docId = process.env.CLICKUP_MEETING_DOC_ID;
const apiKey = process.env.CLICKUP_API_KEY;

function flatten(pages, depth = 0, out = []) {
  for (const p of pages || []) {
    out.push({ id: p.id, name: (p.name || '').trim(), depth });
    if (p.pages) flatten(p.pages, depth + 1, out);
  }
  return out;
}

async function main() {
  if (!workspaceId || !docId || !apiKey) {
    console.error('Missing CLICKUP_WORKSPACE_ID / CLICKUP_MEETING_DOC_ID / CLICKUP_API_KEY');
    process.exit(1);
  }

  if (deleteId) {
    await clickupRequest('DELETE', `/api/v3/workspaces/${workspaceId}/docs/${docId}/pages/${deleteId}`, null, apiKey);
    console.log(`Deleted page ${deleteId}`);
    return;
  }

  const res = await listDocPages(workspaceId, docId, apiKey);
  const pages = res.pages || res || [];
  const flat = flatten(Array.isArray(pages) ? pages : []);
  const rows = match ? flat.filter(p => p.name.toLowerCase().includes(match.toLowerCase())) : flat;

  console.log(`\n${match ? `Pages matching "${match}"` : 'All pages'} (${rows.length}):`);
  for (const p of rows) {
    console.log(`  ${'  '.repeat(p.depth)}- ${p.name}   [${p.id}]`);
  }
  if (match && rows.length > 1) {
    console.log(`\n⚠ ${rows.length} pages share this title — likely duplicates.`);
  }
  console.log('');
}

main().catch(e => { console.error('Failed:', e.message); process.exit(1); });
