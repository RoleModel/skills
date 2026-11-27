#!/usr/bin/env node
// Fleet review runner: runs the review pipeline deterministically and serves a live view.
//
//   node runner.mjs preflight [--base <ref>]   check there is a diff to review; prints branch, base, size
//   node runner.mjs start [--base <ref>]       run the pipeline and serve the live view (run it via longrun)
//   node runner.mjs wait [--timeout <sec>]     block until the latest run in this repo finishes, print the report
//   node runner.mjs status                     print the latest run's phase and URL
//
// Pipeline: core reviewers use Sonnet high; Opus selects conditional roles and their tiers;
// Sol validates, with Astra as needed;
// Sonnet dedupes into the final report.

import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));

// ---- configuration --------------------------------------------------------------------------
const AGENTS = {
  triage: { provider: 'claude', model: 'claude-opus-5-5', effort: 'medium', label: 'Opus 5.5 · medium' },
  astra: { provider: 'codex', model: 'gpt-6-astra', effort: 'medium', label: 'Astra 6 · medium', sandbox: 'workspace-write' },
  sol: { provider: 'codex', model: 'gpt-6.2-sol', effort: 'high', label: 'Sol 6.2 · high', sandbox: 'workspace-write' },
  final: { provider: 'claude', model: 'claude-sonnet-5-5', effort: 'medium', label: 'Sonnet 5.5 · medium' },
};
const REVIEWERS = {
  'terra-high': { provider: 'codex', model: 'gpt-6.1-terra', effort: 'high', label: 'Terra · high' },
  'sonnet-medium': { provider: 'claude', model: 'claude-sonnet-5-5', effort: 'medium', label: 'Sonnet · medium' },
  'terra-xhigh': { provider: 'codex', model: 'gpt-6.1-terra', effort: 'xhigh', label: 'Terra · xhigh' },
  'sonnet-high': { provider: 'claude', model: 'claude-sonnet-5-5', effort: 'high', label: 'Sonnet · high' },
};
const SONNET_HIGH_TIER = 'sonnet-high';
const CONDITIONAL_FALLBACK_TIER = 'sonnet-medium';
const MIN = 60_000;
const TIMEOUTS = { triage: 15 * MIN, role: 30 * MIN, validator: 45 * MIN, final: 15 * MIN };
const KEEP_ALIVE_MS = 120 * MIN; // keep the live view up this long after the run ends
const PORTS = Array.from({ length: 20 }, (_, i) => 4517 + i);
const ACTIVITY_CAP = 60;
const SEVERITY_ORDER = { high: 0, med: 1, low: 2 };

// ---- small helpers --------------------------------------------------------------------------
function arg(name, fallback = null) {
  const i = process.argv.indexOf(name);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function git(args, opts = {}) {
  return execFileSync('git', args, { cwd: opts.cwd || process.cwd(), encoding: 'utf8', maxBuffer: 512 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function gitOk(args) {
  try { git(args); return true; } catch { return false; }
}

function fill(template, vars) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, k) => (k in vars ? String(vars[k]) : ''));
}

function readPrompt(name) {
  return fs.readFileSync(path.join(SCRIPT_DIR, '..', 'templates', `${name}.md`), 'utf8');
}

function bySeverity(a, b) {
  return (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9);
}

function cleanEnv() {
  const env = { ...process.env };
  for (const k of Object.keys(env)) {
    if (k === 'CLAUDECODE' || k.startsWith('CLAUDE_CODE_') || k === 'CLAUDE_PID' || k === 'CLAUDE_EFFORT' || k === 'CLAUDE_AGENT_SDK_VERSION') delete env[k];
  }
  return env;
}

// ---- repo / diff ----------------------------------------------------------------------------
function detectBase() {
  const explicit = arg('--base');
  if (explicit) {
    if (!gitOk(['rev-parse', '--verify', '--quiet', explicit])) throw new Error(`Base ref not found: ${explicit}`);
    return explicit;
  }
  try {
    const head = git(['rev-parse', '--abbrev-ref', 'origin/HEAD']);
    if (head && head !== 'origin/HEAD') return head;
  } catch {}
  for (const c of ['origin/main', 'origin/master', 'main', 'master']) {
    if (gitOk(['rev-parse', '--verify', '--quiet', c])) return c;
  }
  throw new Error('Could not find a base branch. Pass --base <ref>.');
}

function collectDiff() {
  const repo = git(['rev-parse', '--show-toplevel']);
  const gitDir = git(['rev-parse', '--absolute-git-dir']);
  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']);
  const base = detectBase();
  const mergeBase = git(['merge-base', 'HEAD', base]);
  let patch = git(['diff', '--no-color', '--no-ext-diff', mergeBase], { cwd: repo });
  const untracked = git(['ls-files', '--others', '--exclude-standard'], { cwd: repo }).split('\n').filter(Boolean);
  for (const file of untracked.slice(0, 300)) {
    try {
      if (fs.statSync(path.join(repo, file)).size > 1024 * 1024) continue;
      git(['diff', '--no-color', '--no-index', '--', '/dev/null', file], { cwd: repo });
    } catch (e) {
      if (e.stdout) patch += (patch ? '\n' : '') + String(e.stdout).trim();
    }
  }
  const files = new Set();
  let insertions = 0;
  let deletions = 0;
  for (const line of patch.split('\n')) {
    const m = line.match(/^diff --git a\/(.+?) b\//);
    if (m) files.add(m[1]);
    else if (line.startsWith('+') && !line.startsWith('+++')) insertions++;
    else if (line.startsWith('-') && !line.startsWith('---')) deletions++;
  }
  return { repo, gitDir, branch, base, mergeBase, patch, files: files.size, insertions, deletions, untracked: untracked.length };
}

function latestPointer(gitDir) {
  return path.join(gitDir, 'fleet-review', 'latest');
}

function readLatestState() {
  const gitDir = git(['rev-parse', '--absolute-git-dir']);
  const ptr = latestPointer(gitDir);
  if (!fs.existsSync(ptr)) return null;
  const runDir = fs.readFileSync(ptr, 'utf8').trim();
  const file = path.join(runDir, 'state.json');
  if (!fs.existsSync(file)) return null;
  return { runDir, state: JSON.parse(fs.readFileSync(file, 'utf8')) };
}

// ---- schemas (strict, so both providers accept them) ----------------------------------------
const SEVERITY = { type: 'string', enum: ['high', 'med', 'low'] };

const CONDITIONAL_TIERS = Object.keys(REVIEWERS);

function triageSchema(conditionalIds) {
  return {
    type: 'object', additionalProperties: false, required: ['conditional'],
    properties: {
      conditional: {
        type: 'array',
        items: {
          type: 'object', additionalProperties: false, required: ['role', 'applies', 'tier', 'reason'],
          properties: {
            role: { type: 'string', enum: conditionalIds }, applies: { type: 'boolean' },
            tier: { type: 'string', enum: CONDITIONAL_TIERS }, reason: { type: 'string' },
          },
        },
      },
    },
  };
}

const FINDINGS_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['findings'],
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['location', 'title', 'problem', 'impact', 'severity', 'evidence'],
        properties: {
          location: { type: 'string', description: 'file:line' },
          title: { type: 'string', description: 'One-line summary' },
          problem: { type: 'string', description: "What's wrong" },
          impact: { type: 'string', description: 'Why it matters' },
          severity: SEVERITY,
          evidence: { type: 'string', description: 'Evidence or a repro idea' },
        },
      },
    },
  },
};

function validatorSchema(ids, primary) {
  const verdicts = ['confirmed', 'rejected', 'unverifiable'];
  if (primary) verdicts.push('low_risk');
  const secondOpinion = primary
    ? { second_opinion: { type: 'boolean', description: 'Request an independent check of these finding IDs' } }
    : {};
  return {
    type: 'object', additionalProperties: false, required: ['results'],
    properties: {
      results: {
        type: 'array',
        items: {
          type: 'object', additionalProperties: false,
          required: ['finding_ids', 'verdict', 'reason', 'title', 'severity', 'location', ...Object.keys(secondOpinion)],
          properties: {
            finding_ids: { type: 'array', items: { type: 'string', enum: ids } },
            verdict: { type: 'string', enum: verdicts },
            reason: { type: 'string', description: 'Evidence and reasoning for the verdict' },
            title: { type: 'string' },
            severity: SEVERITY,
            location: { type: 'string' },
            ...secondOpinion,
          },
        },
      },
    },
  };
}

function finalSchema(ids) {
  const item = {
    type: 'object', additionalProperties: false,
    required: ['title', 'severity', 'location', 'summary', 'finding_ids', 'astra', 'sol'],
    properties: {
      title: { type: 'string' },
      severity: SEVERITY,
      location: { type: 'string' },
      summary: { type: 'string', description: "What's wrong and why it matters" },
      finding_ids: { type: 'array', items: { type: 'string', enum: ids } },
      astra: { type: 'string', description: "Astra's verdict and reasoning, one line" },
      sol: { type: 'string', description: "Sol's verdict and reasoning, one line" },
    },
  };
  return {
    type: 'object', additionalProperties: false,
    required: ['confirmed_both', 'confirmed_one', 'disagreements', 'dropped'],
    properties: {
      confirmed_both: { type: 'array', items: item },
      confirmed_one: { type: 'array', items: item },
      disagreements: { type: 'array', items: item },
      dropped: {
        type: 'array',
        items: {
          type: 'object', additionalProperties: false, required: ['title', 'finding_ids', 'reason'],
          properties: { title: { type: 'string' }, finding_ids: { type: 'array', items: { type: 'string', enum: ids } }, reason: { type: 'string' } },
        },
      },
    },
  };
}

// ---- state + live server --------------------------------------------------------------------
let state;
let runDir;
let saveTimer = null;
const clients = new Set();

function save(now = false) {
  const write = () => {
    saveTimer = null;
    state.updatedAt = Date.now();
    const json = JSON.stringify(state);
    fs.writeFileSync(path.join(runDir, 'state.json.tmp'), json);
    fs.renameSync(path.join(runDir, 'state.json.tmp'), path.join(runDir, 'state.json'));
    for (const res of clients) res.write(`data: ${json}\n\n`);
  };
  if (now) { if (saveTimer) clearTimeout(saveTimer); write(); return; }
  if (!saveTimer) saveTimer = setTimeout(write, 150);
}

function startServer() {
  const uiPath = path.join(SCRIPT_DIR, 'ui.html');
  const server = http.createServer((req, res) => {
    const url = (req.url || '/').split('?')[0];
    if (url === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      res.end(fs.readFileSync(uiPath));
    } else if (url === '/state') {
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify(state));
    } else if (url === '/events') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
      res.write(`data: ${JSON.stringify(state)}\n\n`);
      clients.add(res);
      req.on('close', () => clients.delete(res));
    } else {
      res.writeHead(404); res.end('Not found');
    }
  });
  setInterval(() => { for (const res of clients) res.write(': ping\n\n'); }, 15_000).unref();
  return new Promise((resolve, reject) => {
    const tryPort = (i) => {
      if (i >= PORTS.length) return reject(new Error('No free port for the live view'));
      server.once('error', (e) => (e.code === 'EADDRINUSE' ? tryPort(i + 1) : reject(e)));
      server.listen(PORTS[i], '127.0.0.1', () => resolve(PORTS[i]));
    };
    tryPort(0);
  });
}

// ---- running agents -------------------------------------------------------------------------
const children = new Set();

function activity(node, text) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (!t) return;
  node.activity.push({ t: Date.now(), text: t.length > 240 ? t.slice(0, 237) + '…' : t });
  if (node.activity.length > ACTIVITY_CAP) node.activity.splice(0, node.activity.length - ACTIVITY_CAP);
  save();
}

function describeTool(name, input = {}) {
  const rel = (p) => (p && state ? String(p).replace(state.run.repo + '/', '') : p);
  switch (name) {
    case 'Read': return `Read ${rel(input.file_path)}`;
    case 'Grep': return `Grep "${input.pattern}"${input.path ? ` in ${rel(input.path)}` : ''}`;
    case 'Glob': return `Glob ${input.pattern}`;
    case 'Bash': return `$ ${input.command}`;
    case 'StructuredOutput': return 'Reporting results';
    default: return name;
  }
}

function runAgent(node, cfg, prompt, schema, { timeout, addDirs = [], scratchDir = null }) {
  return new Promise((resolve) => {
    node.status = 'running';
    node.startedAt = Date.now();
    save();
    const cwd = state.run.repo;
    const tag = node.id;
    let args;
    let cmd;
    let lastFile = null;
    if (cfg.provider === 'claude') {
      cmd = 'claude';
      args = ['-p', '--model', cfg.model, '--output-format', 'stream-json', '--verbose',
        '--json-schema', JSON.stringify(schema), '--permission-mode', 'dontAsk',
        '--allowedTools', 'Read', 'Grep', 'Glob', 'Bash',
        '--disallowedTools', 'Edit', 'Write', 'NotebookEdit', 'Task', 'Agent',
        '--strict-mcp-config', '--no-session-persistence'];
      if (cfg.effort) args.push('--effort', cfg.effort);
      for (const d of addDirs) args.push('--add-dir', d);
    } else {
      cmd = 'codex';
      const schemaFile = path.join(runDir, 'agents', `${tag}.schema.json`);
      lastFile = path.join(runDir, 'agents', `${tag}.out.json`);
      fs.writeFileSync(schemaFile, JSON.stringify(schema));
      args = ['exec', '-m', cfg.model, '-s', cfg.sandbox || 'read-only', '--json', '--skip-git-repo-check',
        '--output-schema', schemaFile, '-o', lastFile, '-C', cwd];
      if (cfg.effort) args.push('-c', `model_reasoning_effort="${cfg.effort}"`);
      if (scratchDir) args.push('--add-dir', scratchDir);
      args.push('-');
    }
    fs.writeFileSync(path.join(runDir, 'agents', `${tag}.prompt.md`), prompt);
    const log = fs.createWriteStream(path.join(runDir, 'agents', `${tag}.jsonl`));
    const child = spawn(cmd, args, { cwd, env: cleanEnv(), stdio: ['pipe', 'pipe', 'pipe'] });
    children.add(child);
    let output = null;
    let error = null;
    let stderr = '';
    let buf = '';
    let finished = false;

    const handle = (line) => {
      let ev;
      try { ev = JSON.parse(line); } catch { return; }
      if (cfg.provider === 'claude') {
        if (ev.type === 'assistant' && ev.message?.content) {
          for (const c of ev.message.content) {
            if (c.type === 'tool_use') activity(node, describeTool(c.name, c.input));
            else if (c.type === 'text' && c.text?.trim()) activity(node, c.text);
          }
        } else if (ev.type === 'result') {
          if (ev.structured_output) output = ev.structured_output;
          else if (ev.is_error) error = String(ev.result || ev.subtype || 'Agent error');
          else { try { output = JSON.parse(ev.result); } catch { error = 'No structured output returned'; } }
        }
      } else {
        const item = ev.item;
        if (ev.type === 'item.started' && item?.type === 'command_execution') {
          activity(node, '$ ' + String(item.command).replace(/^\/bin\/(?:ba|z)?sh -lc '?(.*?)'?$/, '$1'));
        } else if (ev.type === 'item.completed' && item?.type === 'agent_message') {
          if (!/^\s*[{[]/.test(item.text || '')) activity(node, item.text);
        } else if (ev.type === 'item.completed' && item?.type === 'file_change') {
          activity(node, 'Changed files: ' + (item.changes || []).map((c) => c.path).join(', '));
        } else if (ev.type === 'turn.failed' || ev.type === 'error') {
          error = ev.error?.message || ev.message || 'Agent error';
        }
      }
    };

    child.stdout.on('data', (d) => {
      log.write(d);
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) > -1) { handle(buf.slice(0, i)); buf = buf.slice(i + 1); }
    });
    child.stderr.on('data', (d) => { stderr = (stderr + d).slice(-4000); });
    child.stdin.on('error', () => {});
    child.stdin.end(prompt);

    const timer = setTimeout(() => {
      error = `Timed out after ${Math.round(timeout / MIN)} min`;
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 5000).unref();
    }, timeout);

    const done = (code) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      children.delete(child);
      if (buf.trim()) handle(buf);
      log.end();
      if (cfg.provider === 'codex' && !output && lastFile && fs.existsSync(lastFile)) {
        try { output = JSON.parse(fs.readFileSync(lastFile, 'utf8')); } catch { error = error || 'Could not parse the agent output'; }
      }
      if (!output && !error) error = `Exited with code ${code}. ${stderr.trim().split('\n').slice(-3).join(' ')}`.trim();
      node.finishedAt = Date.now();
      node.status = output ? 'done' : 'failed';
      if (!output) node.error = error;
      save();
      resolve({ ok: !!output, output, error });
    };
    child.on('close', done);
    child.on('error', (e) => { error = e.message; done(-1); });
  });
}

// ---- pipeline -------------------------------------------------------------------------------
function makeNode(id, kind, name, cfg, extra = {}) {
  return { id, kind, name, model: cfg ? cfg.label : null, status: 'pending', startedAt: null, finishedAt: null, activity: [], error: null, ...extra };
}

function baseVars() {
  const r = state.run;
  return { diffPath: path.join(runDir, 'diff.patch'), branch: r.branch, base: r.base, mergeBase: r.mergeBase.slice(0, 12) };
}

// A missing triage decision defaults to running the role at the fallback tier.
async function runTriage(roles) {
  const node = state.nodes.triage;
  const out = {};
  for (const r of roles.core) {
    out[r.id] = {
      applies: true, tier: SONNET_HIGH_TIER, reviewer: REVIEWERS[SONNET_HIGH_TIER].label,
      reason: 'Fixed assignment for core roles.',
    };
  }
  node.decisions = out;
  if (!roles.conditional.length) {
    node.status = 'skipped';
    node.summary = 'No conditional roles';
    save();
    return out;
  }

  const list = (rs) => rs.map((r) => `- \`${r.id}\` **${r.name}**: ${r.brief}`).join('\n');
  const prompt = fill(readPrompt('triage'), { ...baseVars(), coreRoles: list(roles.core), conditionalRoles: list(roles.conditional) });
  const schema = triageSchema(roles.conditional.map((r) => r.id));
  const res = await runAgent(node, AGENTS.triage, prompt, schema, { timeout: TIMEOUTS.triage, addDirs: [runDir] });
  const picked = {};
  if (res.ok) {
    for (const v of res.output.conditional || []) {
      if (CONDITIONAL_TIERS.includes(v.tier)) picked[v.role] = { applies: !!v.applies, tier: v.tier, reason: v.reason };
    }
  }
  const fallback = res.ok ? 'Triage returned no decision for this role' : 'Triage failed';
  for (const r of roles.conditional) {
    const decision = picked[r.id] || { applies: true, tier: CONDITIONAL_FALLBACK_TIER, reason: fallback, fallback: true };
    out[r.id] = { ...decision, reviewer: REVIEWERS[decision.tier].label };
  }
  const applies = roles.conditional.filter((r) => out[r.id].applies).length;
  node.summary = res.ok ? `${applies} of ${roles.conditional.length} apply` : 'failed: all roles kept';
  save();
  return out;
}

async function runRole(role, roles, tier) {
  const node = state.nodes[role.id];
  const reviewer = REVIEWERS[tier];
  node.effort = reviewer.effort;
  node.model = reviewer.label;
  let roleList = '';
  if (role.needsRoleList) {
    const all = [...roles.core, ...roles.conditional].filter((r) => r.id !== role.id);
    roleList = '\nThe other roles, so you know what they already cover:\n' + all.map((r) => `- **${r.name}**: ${r.brief}`).join('\n') + '\n';
  }
  const prompt = fill(readPrompt('role'), { ...baseVars(), roleName: role.name, roleBrief: role.brief, roleList });
  const res = await runAgent(node, reviewer, prompt, FINDINGS_SCHEMA, { timeout: TIMEOUTS.role, addDirs: [runDir] });
  node.findings = res.ok ? (res.output.findings || []).slice().sort(bySeverity) : [];
  save();
}

async function runValidator(id, findings) {
  const node = state.nodes[id];
  const primary = id === 'sol';
  const scratchDir = path.join(os.tmpdir(), 'fleet-review', state.run.id, id);
  fs.mkdirSync(scratchDir, { recursive: true });
  const validationFocus = primary
    ? readPrompt('sol-risk').trim()
    : 'You are giving an independent second opinion on the findings below. Review only these finding IDs.';
  const prompt = fill(readPrompt('validator'), {
    ...baseVars(), scratchDir, validationFocus, findingsJson: JSON.stringify(findings),
  });
  const res = await runAgent(node, AGENTS[id], prompt, validatorSchema(findings.map((f) => f.id), primary), {
    timeout: TIMEOUTS.validator, scratchDir,
  });
  node.results = res.ok ? (res.output.results || []).slice().sort(bySeverity) : [];
  const verdicts = findingVerdicts(node.results);
  node.verdicts = verdicts;
  node.counts = { confirmed: 0, rejected: 0, unverifiable: 0, low_risk: 0 };
  for (const v of Object.values(verdicts)) node.counts[v]++;
  save();
  return res.ok ? node.results : null;
}

function findingVerdicts(results) {
  return Object.fromEntries(results.flatMap((r) => r.finding_ids.map((id) => [id, r.verdict])));
}

// Keep verdicts available if the final deduplication step fails.
function fallbackBuckets(findings, secondOpinionIds, va = {}, vs = {}) {
  const out = { confirmed_both: [], confirmed_one: [], disagreements: [], dropped: [] };
  for (const f of findings) {
    const a = va[f.id] || (secondOpinionIds.has(f.id) ? 'no verdict' : 'not requested');
    const s = vs[f.id] || 'no verdict';
    const item = { title: f.title, severity: f.severity, location: f.location, summary: `${f.problem} ${f.impact}`.trim(), finding_ids: [f.id], astra: a, sol: s };
    const conf = [a, s].filter((v) => v === 'confirmed').length;
    if (conf === 2) out.confirmed_both.push(item);
    else if (conf === 1 && [a, s].includes('rejected')) out.disagreements.push(item);
    else if (conf === 1) out.confirmed_one.push(item);
    else if ([a, s].includes('rejected') && ![a, s].includes('unverifiable') && ![a, s].includes('no verdict')) continue;
    else out.dropped.push({ title: f.title, finding_ids: [f.id], reason: `Astra: ${a}, Sol: ${s}` });
  }
  return out;
}

function renderReport(final, note = '') {
  const r = state.run;
  const lines = [`## Fleet review: \`${r.branch}\` vs \`${r.base}\``, ''];
  if (note) lines.push(`> ${note}`, '');
  const section = (title, items, withBoth) => {
    lines.push(`### ${title} (${items.length})`, '');
    if (!items.length) { lines.push('None.', ''); return; }
    items.slice().sort(bySeverity).forEach((it, i) => {
      lines.push(`${i + 1}. **[${it.severity.toUpperCase()}] ${it.title}** \`${it.location}\``);
      lines.push(`   ${it.summary}`);
      if (withBoth) lines.push(`   - Astra: ${it.astra}`, `   - Sol: ${it.sol}`);
    });
    lines.push('');
  };
  section('Confirmed by both', final.confirmed_both, false);
  section('Confirmed by one', final.confirmed_one, true);
  section('Disagreements', final.disagreements, true);
  return lines.join('\n');
}

function finish(report, phase = 'done') {
  state.report = report;
  state.run.phase = phase;
  state.run.finishedAt = Date.now();
  fs.writeFileSync(path.join(runDir, 'report.md'), report + '\n');
  save(true);
}

async function pipeline(roles) {
  state.run.phase = 'triage';
  save();
  const decisions = await runTriage(roles);
  const selected = [];
  for (const r of [...roles.core, ...roles.conditional]) {
    const node = state.nodes[r.id];
    const d = decisions[r.id];
    node.triage = d;
    if (d.applies) selected.push(r);
    else { node.status = 'skipped'; node.reason = `Triage: ${d.reason}`; }
  }
  state.run.roster = { core: roles.core.length, conditional: selected.length - roles.core.length, total: roles.core.length + roles.conditional.length };
  state.run.phase = 'review';
  save();
  await Promise.all(selected.map((r) => runRole(r, roles, decisions[r.id].tier)));

  const findings = [];
  for (const r of [...roles.core, ...roles.conditional]) {
    for (const f of state.nodes[r.id].findings || []) {
      const id = `F${findings.length + 1}`;
      f.id = id;
      findings.push({ id, role: r.name, ...f });
    }
  }
  state.findings = findings;
  fs.writeFileSync(path.join(runDir, 'findings.json'), JSON.stringify(findings, null, 2));
  const failedRoles = [...roles.core, ...roles.conditional].filter((r) => state.nodes[r.id].status === 'failed').map((r) => r.name);
  const roleNote = failedRoles.length ? `These reviewers failed and are missing from this report: ${failedRoles.join(', ')}.` : '';
  save();
  if (!findings.length) {
    for (const id of ['astra', 'sol', 'final']) state.nodes[id].status = 'skipped';
    state.final = { confirmed_both: [], confirmed_one: [], disagreements: [], dropped: [] };
    return finish(renderReport(state.final, ['No reviewer reported any findings.', roleNote].filter(Boolean).join(' ')));
  }

  state.run.phase = 'validate';
  save();
  const rs = await runValidator('sol', findings);
  const solResults = (rs || []).filter((r) => r.verdict !== 'low_risk');
  // A conflicting verdict or explicit second-opinion request keeps a finding in review.
  const reviewIds = new Set((rs || [])
    .filter((r) => r.verdict !== 'low_risk' || r.second_opinion !== false)
    .flatMap((r) => r.finding_ids));
  const filtered = (rs || [])
    .filter((r) => r.verdict === 'low_risk' && r.second_opinion === false)
    .map(({ title, finding_ids, reason }) => ({
      title, finding_ids: finding_ids.filter((id) => !reviewIds.has(id)), reason: `Sol filtered for low practical risk. ${reason}`,
    }))
    .filter((r) => r.finding_ids.length);
  const filteredIds = new Set(filtered.flatMap((r) => r.finding_ids));
  const remaining = findings.filter((f) => !filteredIds.has(f.id));
  const riskNote = filteredIds.size
    ? `Sol filtered ${filteredIds.size} of ${findings.length} findings for low practical risk. Reasons are in the dashboard.`
    : '';
  const resolvedIds = new Set(solResults
    .filter((r) => !r.second_opinion && ['confirmed', 'rejected'].includes(r.verdict))
    .flatMap((r) => r.finding_ids));
  const referredIds = new Set(solResults
    .filter((r) => r.second_opinion || r.verdict === 'unverifiable')
    .flatMap((r) => r.finding_ids));
  const secondOpinion = remaining.filter((f) => !resolvedIds.has(f.id) || referredIds.has(f.id));
  const secondOpinionIds = new Set(secondOpinion.map((f) => f.id));
  const astra = state.nodes.astra;
  astra.requestedFindingIds = [...secondOpinionIds];
  if (!secondOpinion.length) {
    astra.status = 'skipped';
    astra.reason = 'No second opinion requested.';
  }
  if (!remaining.length) {
    state.nodes.final.status = 'skipped';
    state.final = { confirmed_both: [], confirmed_one: [], disagreements: [], dropped: filtered };
    return finish(renderReport(state.final, [riskNote, roleNote].filter(Boolean).join(' ')));
  }
  const ra = secondOpinion.length ? await runValidator('astra', secondOpinion) : null;
  if (!ra && !rs) {
    state.nodes.final.status = 'skipped';
    const list = findings.map((f, i) => `${i + 1}. **[${f.severity.toUpperCase()}] ${f.title}** \`${f.location}\` (${f.role})\n   ${f.problem}`).join('\n');
    return finish(`## Fleet review: \`${state.run.branch}\` vs \`${state.run.base}\`\n\n> Both validators failed, so these findings are unvalidated. ${roleNote}\n\n${list}`, 'failed');
  }

  state.run.phase = 'final';
  save();
  const ids = remaining.map((f) => f.id);
  const validationNotes = [
    !rs ? 'Sol failed. Astra was asked to validate all findings.' : '',
    secondOpinion.length && !ra ? 'Astra failed. Its requested second opinions are unavailable.' : '',
  ].filter(Boolean);
  const prompt = fill(readPrompt('final'), {
    secondOpinionIds: JSON.stringify([...secondOpinionIds]),
    findingsJson: JSON.stringify(remaining),
    astraResults: JSON.stringify(ra || []),
    solResults: JSON.stringify(solResults),
  });
  const res = await runAgent(state.nodes.final, AGENTS.final, prompt, finalSchema(ids), { timeout: TIMEOUTS.final });
  let note = [riskNote, roleNote, ...validationNotes].filter(Boolean).join(' ');
  if (res.ok) {
    state.final = res.output;
  } else {
    state.final = fallbackBuckets(remaining, secondOpinionIds, astra.verdicts, findingVerdicts(solResults));
    note = `The final dedupe step failed (${res.error}). The report lists each finding separately. ${note}`;
  }
  state.final.dropped.push(...filtered);
  finish(renderReport(state.final, note.trim()));
}

async function start() {
  const roles = JSON.parse(fs.readFileSync(arg('--roles') ? path.resolve(arg('--roles')) : path.join(SCRIPT_DIR, 'roles.json'), 'utf8'));
  for (const r of roles.core) r.core = true;
  const d = collectDiff();
  if (!d.patch.trim()) {
    console.error(`No changes between HEAD and ${d.base}. Nothing to review.`);
    process.exit(1);
  }
  const id = new Date().toISOString().replace(/[:.]/g, '-');
  runDir = path.join(d.gitDir, 'fleet-review', id);
  fs.mkdirSync(path.join(runDir, 'agents'), { recursive: true });
  fs.writeFileSync(path.join(runDir, 'diff.patch'), d.patch + '\n');
  fs.writeFileSync(latestPointer(d.gitDir), runDir + '\n');

  const nodes = {
    diff: makeNode('diff', 'input', 'Diff', null, { status: 'done' }),
    triage: makeNode('triage', 'triage', 'Triage', AGENTS.triage),
    astra: makeNode('astra', 'validator', 'Validator', AGENTS.astra),
    sol: makeNode('sol', 'validator', 'Validator', AGENTS.sol),
    final: makeNode('final', 'final', 'Final report', AGENTS.final),
  };
  for (const r of roles.core) nodes[r.id] = makeNode(r.id, 'core', r.name, null, { brief: r.brief, findings: [], triage: null });
  for (const r of roles.conditional) nodes[r.id] = makeNode(r.id, 'conditional', r.name, null, { brief: r.brief, findings: [], triage: null });

  state = {
    run: {
      id, repo: d.repo, runDir, branch: d.branch, base: d.base, mergeBase: d.mergeBase,
      files: d.files, insertions: d.insertions, deletions: d.deletions, untracked: d.untracked,
      startedAt: Date.now(), finishedAt: null, phase: 'starting', url: null, roster: null,
    },
    roles: { core: roles.core.map((r) => r.id), conditional: roles.conditional.map((r) => r.id) },
    nodes, findings: [], final: null, report: null,
  };
  save(true);

  const port = await startServer();
  state.run.url = `http://localhost:${port}`;
  save(true);
  console.log(`Live view: ${state.run.url}`);
  console.log(`Run dir: ${runDir}`);

  const stop = (sig) => {
    for (const c of children) c.kill('SIGTERM');
    if (!['done', 'failed'].includes(state.run.phase)) {
      state.run.phase = 'failed';
      state.run.error = `Stopped (${sig})`;
      state.run.finishedAt = Date.now();
    }
    save(true);
    process.exit(0);
  };
  process.on('SIGINT', () => stop('SIGINT'));
  process.on('SIGTERM', () => stop('SIGTERM'));

  try {
    await pipeline(roles);
  } catch (e) {
    state.run.phase = 'failed';
    state.run.error = e.stack || String(e);
    state.run.finishedAt = Date.now();
    save(true);
    console.error(e);
  }
  console.log(`Review ${state.run.phase}. Live view stays up for ${KEEP_ALIVE_MS / MIN} min: ${state.run.url}`);
  setTimeout(() => process.exit(0), KEEP_ALIVE_MS);
}

async function wait() {
  const timeoutSec = Number(arg('--timeout', '7000'));
  const until = Date.now() + timeoutSec * 1000;
  let shown = false;
  for (;;) {
    const latest = readLatestState();
    if (latest) {
      const { state: s, runDir: dir } = latest;
      if (!shown && s.run.url) { console.log(`Live view: ${s.run.url}`); shown = true; }
      if (s.run.phase === 'done' || s.run.phase === 'failed') {
        if (s.run.error) console.log(`Run failed: ${s.run.error}`);
        const report = path.join(dir, 'report.md');
        if (fs.existsSync(report)) console.log('\n' + fs.readFileSync(report, 'utf8'));
        console.log(`Run dir: ${dir}`);
        process.exit(s.run.phase === 'done' ? 0 : 1);
      }
    }
    if (Date.now() > until) {
      console.log(`Still running${latest ? ` (phase: ${latest.state.run.phase})` : ''}. Run wait again to keep waiting.`);
      process.exit(2);
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
}

function status() {
  const latest = readLatestState();
  if (!latest) { console.log('No review runs in this repo yet.'); return; }
  const r = latest.state.run;
  console.log(`Phase: ${r.phase}\nBranch: ${r.branch} vs ${r.base}\nStarted: ${new Date(r.startedAt).toLocaleString()}\nLive view: ${r.url || '(not up)'}\nRun dir: ${latest.runDir}`);
}

function preflight() {
  const d = collectDiff();
  if (!d.patch.trim()) {
    console.log(`No changes between HEAD and ${d.base}. Nothing to review.`);
    process.exit(1);
  }
  console.log(`Branch: ${d.branch}\nBase: ${d.base} (merge base ${d.mergeBase.slice(0, 12)})\nDiff: ${d.files} file${d.files === 1 ? '' : 's'}, +${d.insertions} -${d.deletions}${d.untracked ? ` (includes ${d.untracked} untracked)` : ''}`);
}

const cmd = process.argv[2];
try {
  if (cmd === 'start') await start();
  else if (cmd === 'wait') await wait();
  else if (cmd === 'status') status();
  else if (cmd === 'preflight') preflight();
  else { console.log('Usage: runner.mjs preflight|start|wait|status [--base <ref>] [--timeout <sec>]'); process.exit(64); }
} catch (e) {
  console.error(e.message || e);
  process.exit(1);
}
