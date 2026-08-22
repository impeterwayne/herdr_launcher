#!/usr/bin/env node
'use strict';

const h = require('../lib/herdr');
const stash = require('../lib/stash');
const { resolveContext, isOurs } = require('../lib/context');

const argv = process.argv.slice(2);
const dryRun = argv.includes('--dry-run');
const forceEnter = argv.includes('--enter');
const forceExit = argv.includes('--exit');

const report = (payload) => process.stdout.write(`${JSON.stringify(payload)}\n`);

function zoomToggle(paneId, reason) {
  if (dryRun) return report({ action: 'zoom-toggle', pane: paneId, reason });
  const result = h.tryHerdr(['pane', 'zoom', paneId, '--toggle']);
  const zoomed = result && result.zoom ? result.zoom.zoomed : null;
  return report({ action: 'zoom-toggled', pane: paneId, zoomed, reason });
}

function main() {
  const ctx = resolveContext();
  if (!ctx.pane) throw new Error('no active pane — is a herdr session running?');

  const tabId = ctx.pane.tab_id;
  const entry = stash.entryFor(tabId);

  if (entry && !forceEnter) {
    return report(stash.exit(entry, { dryRun }));
  }
  if (forceExit) return report({ action: 'noop', reason: 'not in focus mode', tab: tabId });

  const sidebar = ctx.panes.find((p) => p.tab_id === tabId && isOurs(p));
  if (!sidebar) return zoomToggle(ctx.pane.pane_id, 'no launcher docked in this tab');

  const result = stash.enter({
    workPane: ctx.pane.pane_id,
    sidebarPane: sidebar.pane_id,
    tabId,
    workspaceId: ctx.pane.workspace_id,
    dryRun,
  });

  if (result.action === 'refused') return zoomToggle(ctx.pane.pane_id, result.reason);
  return report(result);
}

try {
  main();
} catch (err) {
  process.stderr.write(`${err.message}\n`);
  process.exit(1);
}
