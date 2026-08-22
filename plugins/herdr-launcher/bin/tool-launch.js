#!/usr/bin/env node
'use strict';

const path = require('node:path');
const h = require('../lib/herdr');
const dock = require('../lib/dock');
const { byKey, TOOLS } = require('../lib/views');
const { resolveContext, readConfig, OWNER_TOKEN, TOOL_TOKEN, toolOf } = require('../lib/context');

const ROOT = path.resolve(__dirname, '..');
const JS_ENTRY = path.join(ROOT, 'bin', 'tool-pane.js');

const CONFIG = readConfig('tools.json') || {};

const argv = process.argv.slice(2);

function usage(code) {
  const keys = TOOLS.map((t) => `  ${t.key.padEnd(10)} ${t.label}`).join('\n');
  process.stderr.write(
    `usage: tool-launch.js <tool-key> [--cols N] [--ratio N] [--dry-run]\n\n${keys}\n`
  );
  process.exit(code);
}

if (!argv.length || argv[0] === '--help' || argv[0] === '-h') usage(argv.length ? 0 : 1);

const tool = byKey(argv[0]);
if (!tool) {
  process.stderr.write(`unknown tool key: ${argv[0]}\n`);
  usage(1);
}

const flag = (name) => {
  const i = argv.indexOf(name);
  return i !== -1 && argv[i + 1] ? Number(argv[i + 1]) : null;
};

const dryRun = argv.includes('--dry-run');
const cols = flag('--cols') || Number((CONFIG.cols || {})[tool.key]) || tool.cols;

function rectOf(paneId) {
  const layout = h.paneLayout(paneId);
  const found = layout.panes.find((p) => p.pane_id === paneId);
  return found ? found.rect : null;
}

function main() {
  const ctx = resolveContext();
  if (!ctx.pane) throw new Error('no active pane to split — open a pane first');

  const open = ctx.panes.find((p) => p.tab_id === ctx.pane.tab_id && toolOf(p) === tool.key);
  if (open) {

    const alone = !ctx.panes.some(
      (p) => p.tab_id === open.tab_id && p.pane_id !== open.pane_id
    );
    if (alone) {
      if (dryRun) return report({ action: 'focus', tool: tool.key, pane: open.pane_id });
      h.focusPane(open.pane_id);
      return report({ action: 'focused', tool: tool.key, pane: open.pane_id });
    }
    if (dryRun) return report({ action: 'close', tool: tool.key, pane: open.pane_id });
    h.paneClose(open.pane_id);
    return report({ action: 'closed', tool: tool.key, pane: open.pane_id });
  }

  const rect = rectOf(ctx.pane.pane_id);
  const width = (rect && rect.width) || 0;
  const ratio =
    flag('--ratio') || (width ? Math.min(0.95, Math.max(0.2, (width - cols) / width)) : 0.5);

  const env = { HERDR_ACTIVE_PANE_ID: ctx.pane.pane_id, HERDR_ACTIVE_PANE_CWD: ctx.cwd };
  const command = ['node', JS_ENTRY, tool.key];
  if (process.argv.includes('--ascii-icons')) command.push('--ascii-icons');

  if (dryRun) {
    return report({
      action: 'open',
      tool: tool.key,
      target: ctx.pane.pane_id,
      targetWidth: width || null,
      wantCols: cols,
      ratio: Number(ratio.toFixed(4)),
      cwd: ctx.cwd,

      command: [...command, '--pane', '<new>'],
    });
  }

  const paneId = h.splitRight(ctx.pane.pane_id, ratio, ctx.cwd, env);
  h.paneRename(paneId, tool.label);

  h.stampToken(paneId, OWNER_TOKEN, TOOL_TOKEN, tool.key, dock.TOKEN_TTL_MS);
  h.paneRun(paneId, ...command, '--pane', paneId);
  h.focusPane(paneId);
  return report({
    action: 'opened',
    tool: tool.key,
    pane: paneId,
    ratio: Number(ratio.toFixed(4)),
    cols,
  });
}

function report(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

try {
  main();
} catch (err) {
  process.stderr.write(`${err.message}\n`);
  process.exit(1);
}
