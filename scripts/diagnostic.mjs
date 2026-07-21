#!/usr/bin/env node
/**
 * diagnostic — one-shot: reads Claude Code + Antigravity local usage stores,
 * prints 5h/7d windows for both, and shows the gateway ledger if present.
 * Run before deciding agent allocation. Reads nothing, writes nothing, costs nothing.
 * Usage: node scripts/diagnostic.mjs
 */
import { homedir } from 'node:os';
import { join } from 'node:path';
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const now = Date.now();
const H5 = 5 * 60 * 60 * 1000;
const D7 = 7 * 24 * 60 * 60 * 1000;

// ═══════════════════════════════════════════════════════════════
// CLAUDE CODE
// ═══════════════════════════════════════════════════════════════
const claudeProjects = join(homedir(), '.claude', 'projects');
let claudeSessions = [];
try {
  for (const dir of readdirSync(claudeProjects)) {
    const dirPath = join(claudeProjects, dir);
    if (!statSync(dirPath).isDirectory()) continue;
    for (const file of readdirSync(dirPath)) {
      if (!file.endsWith('.jsonl')) continue;
      const fp = join(dirPath, file);
      const stat = statSync(fp);
      let lines = 0, input = 0, output = 0, cacheWrite = 0, cacheRead = 0;
      try {
        const text = readFileSync(fp, 'utf8');
        for (const line of text.split('\n')) {
          if (!line.trim()) continue;
          try {
            const r = JSON.parse(line);
            const u = r?.message?.usage;
            if (!u) continue;
            lines++;
            input += u.input_tokens || 0;
            output += u.output_tokens || 0;
            cacheWrite += u.cache_creation_input_tokens || 0;
            cacheRead += u.cache_read_input_tokens || 0;
          } catch { /* skip malformed line */ }
        }
      } catch { /* skip unreadable file */ }
      if (lines > 0) {
        claudeSessions.push({
          project: dir.slice(-50),
          session: file.replace('.jsonl', ''),
          lines, input, output, cacheWrite, cacheRead,
          billable: input + output + cacheWrite,
          modified: stat.mtime,
        });
      }
    }
  }
} catch (e) { console.log('Claude dir error:', e.message); }

function sumWindow(sessions, windowMs) {
  const cutoff = now - windowMs;
  return sessions
    .filter(s => s.modified.getTime() >= cutoff)
    .reduce((a, s) => ({
      input: a.input + s.input, output: a.output + s.output,
      cacheWrite: a.cacheWrite + s.cacheWrite, billable: a.billable + s.billable,
      sessions: a.sessions + 1,
    }), { input: 0, output: 0, cacheWrite: 0, billable: 0, sessions: 0 });
}

const c5h = sumWindow(claudeSessions, H5);
const c7d = sumWindow(claudeSessions, D7);

console.log('═══════════════════════════════════════════');
console.log('  CLAUDE CODE (Pro $20/mo)');
console.log('═══════════════════════════════════════════');
console.log(`  Total sessions on disk: ${claudeSessions.length}`);
console.log(`  5h window: ${c5h.billable.toLocaleString()} billable tokens (${c5h.sessions} sessions)`);
console.log(`  7d window: ${c7d.billable.toLocaleString()} billable tokens (${c7d.sessions} sessions)`);
if (c5h.sessions > 0) {
  console.log(`  5h breakdown: input=${c5h.input.toLocaleString()} output=${c5h.output.toLocaleString()} cacheWrite=${c5h.cacheWrite.toLocaleString()}`);
}

// Sessions in last 24h
const d1 = claudeSessions.filter(s => now - s.modified.getTime() < 86400000).sort((a,b) => b.modified - a.modified);
if (d1.length > 0) {
  console.log(`\n  Recent (last 24h):`);
  for (const s of d1.slice(0, 10)) {
    const ago = Math.round((now - s.modified.getTime()) / 3600000 * 10) / 10;
    console.log(`    ${ago}h ago | ${s.billable.toLocaleString().padStart(9)} tokens | ${String(s.lines).padStart(3)} turns | ${s.project}`);
  }
}

// ═══════════════════════════════════════════════════════════════
// ANTIGRAVITY (token-level decode via existing antigravity-usage.mjs)
// ═══════════════════════════════════════════════════════════════
console.log(`\n═══════════════════════════════════════════`);
console.log(`  ANTIGRAVITY (Pro $20/mo)`);
console.log(`═══════════════════════════════════════════`);

// Use the existing module — it already knows how to decode protobuf
import { antigravityUsage } from '../antigravity-usage.mjs';
try {
  const usage = antigravityUsage(); // reads all local dbs
  console.log(`  5h window: ${usage.last5h.billable.toLocaleString()} billable tokens (${usage.last5h.messages} messages)`);
  console.log(`  7d window: ${usage.last7d.billable.toLocaleString()} billable tokens (${usage.last7d.messages} messages)`);
  console.log(`  5h breakdown: input=${usage.last5h.input.toLocaleString()} output=${usage.last5h.output.toLocaleString()} cacheWrite=${usage.last5h.cacheWrite.toLocaleString()}`);

  // List individual conversation DBs
  try {
    const agyDirs = [
      join(homedir(), '.gemini', 'antigravity', 'conversations'),
      join(homedir(), '.gemini', 'antigravity-ide', 'conversations'),
    ];
    let count = 0;
    for (const dir of agyDirs) {
      try {
        const files = readdirSync(dir).filter(f => f.endsWith('.db'));
        for (const f of files.slice(0, 10)) {
          try {
            const stat = statSync(join(dir, f));
            const ago = Math.round((now - stat.mtime.getTime()) / 3600000 * 10) / 10;
            console.log(`    ${ago}h ago | ${join(dir, f).replace(homedir(), '~')}`);
            count++;
          } catch {}
        }
      } catch {}
    }
  } catch {}
} catch (e) {
  console.log(`  Could not decode via antigravity-usage.mjs: ${e.message}`);
  // Fallback: just count DB files
  const agyDirs = [
    join(homedir(), '.gemini', 'antigravity', 'conversations'),
    join(homedir(), '.gemini', 'antigravity-ide', 'conversations'),
  ];
  for (const dir of agyDirs) {
    try {
      const files = readdirSync(dir).filter(f => f.endsWith('.db'));
      if (files.length > 0) console.log(`  ${dir.replace(homedir(), '~')}: ${files.length} conversation DBs`);
    } catch {}
  }
}

// ═══════════════════════════════════════════════════════════════
// GATEWAY LEDGER (mos-dev)
// ═══════════════════════════════════════════════════════════════
console.log(`\n═══════════════════════════════════════════`);
console.log(`  GATEWAY LEDGER (mos-dev)`);
console.log(`═══════════════════════════════════════════`);
const mosLedger = join(process.cwd(), '..', 'mos-dev', '.ai', 'gateway', 'ledger.db');
if (existsSync(mosLedger)) {
  try {
    const db = new DatabaseSync(mosLedger);
    const total = db.prepare(`SELECT COUNT(*) as cnt, SUM(input_tokens) as total_in, SUM(output_tokens) as total_out, SUM(cost_usd) as total_cost, COUNT(CASE WHEN enforcement_decision='deny' THEN 1 END) as denies FROM token_events`).get();
    console.log(`  Total events: ${total.cnt}`);
    console.log(`  Total tokens: ${(total.total_in || 0).toLocaleString()} in / ${(total.total_out || 0).toLocaleString()} out`);
    console.log(`  Total cost:   $${(total.total_cost || 0).toFixed(6)}`);
    console.log(`  Deny events:  ${total.denies || 0}`);

    // Per-agent breakdown
    const agents = db.prepare(`SELECT agent, COUNT(*) as cnt, SUM(cost_usd) as cost FROM token_events GROUP BY agent ORDER BY cost DESC`).all();
    if (agents.length > 0) {
      console.log(`\n  Per-agent:`);
      for (const a of agents) console.log(`    ${a.agent}: ${a.cnt} calls, $${(a.cost || 0).toFixed(6)}`);
    }
    db.close();
  } catch (e) { console.log(`  Ledger error: ${e.message}`); }
} else {
  console.log(`  No ledger at ${mosLedger}`);
  // Also check meridianos-core
  const coreLedger = join(process.cwd(), '.ai', 'gateway', 'ledger.db');
  if (existsSync(coreLedger)) {
    console.log(`  Found at meridianos-core: ${coreLedger}`);
  } else {
    console.log(`  No ledger found in either location`);
  }
}

// ═══════════════════════════════════════════════════════════════
// SUMMARY
// ═══════════════════════════════════════════════════════════════
console.log(`\n═══════════════════════════════════════════`);
console.log(`  QUOTA GUARD RECOMMENDATION`);
console.log(`═══════════════════════════════════════════`);
console.log(`  Claude Code Pro ($20/mo) — use ONLY for:`);
console.log(`    • Code review (small, focused prompts)`);
console.log(`    • Complex debugging (1-2 calls/day max)`);
console.log(`  Antigravity Gemini (Pro $20/mo) — use for:`);
console.log(`    • UI/UX design tasks`);
console.log(`    • Documentation and content`);
console.log(`    • Light automation (not heavy implementation)`);
console.log(`  DeepSeek V4 (API key, gateway-metered) — use for:`);
console.log(`    • ALL heavy implementation work`);
console.log(`    • Bulk agent runs (cheap, metered, capped)`);
console.log(`  DO NOT use Claude Code or Antigravity Sonnet/Opus for:`);
console.log(`    • Multi-turn agent implementation runs`);
console.log(`    • Anything the gateway can meter via DeepSeek`);
console.log(`═══════════════════════════════════════════`);
