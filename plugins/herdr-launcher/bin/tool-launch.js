#!/usr/bin/env node
'use strict';
// Open a workspace tool in a pane of its own.
//
//   node tool-launch.js <tool-key> [--cols N] [--ratio N] [--dry-run]
//
// Symlinks, OpenSpec and Plane used to run as sub-views inside the launcher
// sidebar. They are panes now: a symlink's target path, an OpenSpec component's
// state and a Plane issue's title-plus-state all want more than the sidebar's
// 36 columns, and a pane costs the layout nothing while it is closed.
//
// A second press does NOT open a second pane — unlike the agent launchers,
// where another instance is the point. There is one worktree to link and one
// issue list to read, so the tool pane already open in this tab is focused
// instead. That is what the TOOL_TOKEN stamp is for.
//
// The pane is split off the pane the user is working in, not off the sidebar:
// resolveContext() never hands back a plugin-owned pane, so the tool lands
// beside the work and the sidebar keeps its columns.

const path = require('node:path');
const h = require('../lib/herdr');
const dock = require('../lib/dock');
const { byKey, TOOLS } = require('../lib/views');
const { resolveContext, readConfig, OWNER_TOKEN, TOOL_TOKEN, toolOf } = require('../lib/context');

const ROOT = path.resolve(__dirname, '..');
const JS_ENTRY = path.join(ROOT, 'bin', 'tool-pane.js');

// tools.json in the plugin config dir: { "cols": { "plane": 72 } }.
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

/** The rect of `paneId` inside its own tab's layout. */
function rectOf(paneId) {
  const layout = h.paneLayout(paneId);
  const found = layout.panes.find((p) => p.pane_id === paneId);
  return found ? found.rect : null;
}

function main() {
  const ctx = resolveContext();
  if (!ctx.pane) throw new Error('no active pane to split — open a pane first');

  // Already open in this tab? Focus it. One worktree, one list, one pane.
  const open = ctx.panes.find((p) => p.tab_id === ctx.pane.tab_id && toolOf(p) === tool.key);
  if (open) {
    if (dryRun) return report({ action: 'focus', tool: tool.key, pane: open.pane_id });
    h.focusPane(open.pane_id);
    return report({ action: 'focused', tool: tool.key, pane: open.pane_id });
  }

  // --ratio is the ORIGINAL pane's share of the split, so leave `cols` for the
  // tool. Same arithmetic as dock.open(), and the same clamp: herdr hard-clamps
  // every ratio to [0.1, 0.9], so a narrow work pane yields less than asked.
  const rect = rectOf(ctx.pane.pane_id);
  const width = (rect && rect.width) || 0;
  const ratio =
    flag('--ratio') || (width ? Math.min(0.95, Math.max(0.2, (width - cols) / width)) : 0.5);

  // The tool resolves its worktree from the pane it was opened FROM, not from
  // its own cwd, so the answer does not drift if the user cds afterwards.
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
      // The real invocation ends in `--pane <id>`; there is no id until the
      // split has happened, which is the one thing a dry run does not do.
      command: [...command, '--pane', '<new>'],
    });
  }

  const paneId = h.splitRight(ctx.pane.pane_id, ratio, ctx.cwd, env);
  h.paneRename(paneId, tool.label);
  // Stamp before running, so a second press queued behind this one sees a live
  // pane instead of splitting another; tool-pane.js refreshes it every 30s.
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
