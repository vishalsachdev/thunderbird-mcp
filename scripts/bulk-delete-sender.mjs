#!/usr/bin/env node
// Deterministic bulk-delete-by-sender + optional auto-delete filter.
// No LLM calls: reads message IDs straight from mailcorpus's read-only SQLite
// mirror (fast, no live IMAP round trip), falls back to a live search via the
// thunderbird-mcp bridge only for the date range mailcorpus hasn't ingested
// (its retention window, or anything since the last 6h ingest run), then
// calls deleteMessages / createFilter on the bridge for the actual mutation.
//
// Usage:
//   node scripts/bulk-delete-sender.mjs --from <substring> [--account <id>] [--folder <uri>] [--create-filter] [--yes]
//
// Dry-run by default — prints counts and a sample without deleting anything.
// Pass --yes to actually delete. --create-filter also requires --yes.

import { DatabaseSync } from 'node:sqlite';
import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BRIDGE_PATH = join(__dirname, '..', 'mcp-bridge.cjs');
const MAILCORPUS_DB = process.env.MAILCORPUS_DB || join(homedir(), '.local/share/mailcorpus/mail.db');

function parseArgs(argv) {
  const out = { yes: false, createFilter: false, folder: null, account: null, from: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--from') out.from = argv[++i];
    else if (a === '--account') out.account = argv[++i];
    else if (a === '--folder') out.folder = argv[++i];
    else if (a === '--create-filter') out.createFilter = true;
    else if (a === '--yes') out.yes = true;
    else throw new Error(`Unknown arg: ${a}`);
  }
  if (!out.from) throw new Error('--from <substring> is required');
  return out;
}

function idsFromCorpus(fromSubstring) {
  const db = new DatabaseSync(MAILCORPUS_DB, { readOnly: true });
  try {
    const rows = db
      .prepare(`SELECT message_id, date_utc, folder FROM messages WHERE from_addr LIKE ? OR from_name LIKE ?`)
      .all(`%${fromSubstring}%`, `%${fromSubstring}%`);
    return rows.map((r) => ({ id: String(r.message_id).replace(/^<|>$/g, ''), date: r.date_utc, folder: r.folder }));
  } finally {
    db.close();
  }
}

// --- Minimal JSON-RPC stdio client for mcp-bridge.cjs ---
class Bridge {
  constructor() {
    this.child = spawn('node', [BRIDGE_PATH], { stdio: ['pipe', 'pipe', 'pipe'] });
    this.buf = '';
    this.nextId = 1;
    this.pending = new Map();
    this.child.stdout.on('data', (chunk) => {
      this.buf += chunk.toString();
      let idx;
      while ((idx = this.buf.indexOf('\n')) !== -1) {
        const line = this.buf.slice(0, idx);
        this.buf = this.buf.slice(idx + 1);
        if (!line.trim()) continue;
        let msg;
        try { msg = JSON.parse(line); } catch { continue; }
        const p = this.pending.get(msg.id);
        if (p) { this.pending.delete(msg.id); p.resolve(msg); }
      }
    });
    this.child.stderr.on('data', () => {}); // suppress noise; bridge logs go here
  }

  call(method, params) {
    const id = this.nextId++;
    const payload = JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n';
    return new Promise((resolve) => {
      this.pending.set(id, { resolve });
      this.child.stdin.write(payload);
    });
  }

  async callTool(name, args) {
    const res = await this.call('tools/call', { name, arguments: args });
    if (res.error) throw new Error(`${name}: ${res.error.message}`);
    const text = res.result?.content?.[0]?.text;
    try { return JSON.parse(text); } catch { return text; }
  }

  async init() {
    await this.call('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'bulk-delete-sender', version: '1.0.0' },
    });
  }

  close() {
    this.child.stdin.end();
    this.child.kill();
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const corpusHits = idsFromCorpus(args.from);
  console.log(`mailcorpus: ${corpusHits.length} matches for "${args.from}"`);

  const bridge = new Bridge();
  await bridge.init();

  // Live search fills the gap for anything mailcorpus hasn't ingested yet
  // (its 360-day retention window, or mail newer than the last ingest run).
  // This talks to the bridge process directly (not through the LLM), so full
  // pagination costs zero conversation tokens — only aggregate counts are printed.
  let liveMessages = [];
  let offset = 0;
  let firstFolderPath = null;
  for (;;) {
    const page = await bridge.callTool('searchMessages', {
      query: `from:${args.from}`,
      folderPath: args.folder || undefined,
      maxResults: 200,
      offset,
    });
    const messages = page?.messages || [];
    if (messages.length && !firstFolderPath) firstFolderPath = messages[0].folderPath;
    liveMessages = liveMessages.concat(messages);
    if (!page?.hasMore || messages.length === 0) break;
    offset += messages.length;
  }
  const liveIds = new Set(liveMessages.map((m) => m.id));
  const corpusIds = new Set(corpusHits.map((m) => m.id));
  const merged = new Set([...liveIds, ...corpusIds]);

  console.log(`live search (all pages): ${liveIds.size} matches`);
  console.log(`merged unique IDs: ${merged.size}`);

  // Trust the live server's own folderPath (exact URI, correct case) over any
  // guess built from mailcorpus's denormalized folder name.
  const folderPath = args.folder || firstFolderPath;

  if (!folderPath) {
    console.error('Could not determine folderPath — pass --folder explicitly.');
    bridge.close();
    process.exit(1);
  }
  console.log(`target folder: ${folderPath}`);

  if (!args.yes) {
    console.log('\nDRY RUN — no changes made. Re-run with --yes to delete these messages'
      + (args.createFilter ? ' and create the filter.' : '.'));
    bridge.close();
    return;
  }

  const idList = [...merged];
  const BATCH = 100;
  let deleted = 0;
  let failed = 0;
  for (let i = 0; i < idList.length; i += BATCH) {
    const batch = idList.slice(i, i + BATCH);
    const res = await bridge.callTool('deleteMessages', { messageIds: batch, folderPath });
    if (res?.error) {
      failed += batch.length;
      console.error(`batch ${i / BATCH + 1}: FAILED (${batch.length} messages) — ${res.error}`);
    } else {
      deleted += batch.length;
      console.log(`deleted batch ${i / BATCH + 1}: ${batch.length} messages (${deleted}/${idList.length})`);
    }
  }
  if (failed > 0) {
    console.error(`\n${failed} messages FAILED to delete (see batch errors above) — do not report these as deleted.`);
  }

  if (args.createFilter) {
    if (!args.account) {
      console.error('--create-filter requires --account <id> (see listAccounts)');
    } else {
      const filterRes = await bridge.callTool('createFilter', {
        accountId: args.account,
        name: `Auto-delete: ${args.from}`,
        conditions: [{ attrib: 'from', op: 'contains', value: args.from }],
        actions: [{ type: 'delete' }],
        enabled: true,
      });
      console.log('filter created:', JSON.stringify(filterRes));
    }
  }

  bridge.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
