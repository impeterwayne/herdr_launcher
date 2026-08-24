'use strict';

const fs = require('node:fs');
const path = require('node:path');
const h = require('./herdr');
const { isOurs, hasPluginTokens, OWNER_TOKEN, readConfig } = require('./context');

const ROOT = path.resolve(__dirname, '..');
const CMD_SHIM = path.join(ROOT, 'bin', 'launcher.cmd');
const JS_ENTRY = path.join(ROOT, 'bin', 'launcher.js');

const TOKEN_TTL_MS = 90000;

const BAR_COLS = 20;
const BORDER_COLS = 2;
const EXPANDED_COLS = BAR_COLS + BORDER_COLS;

const defaultCols = () => Number((readConfig('sidebar.json') || {}).expandedCols) || EXPANDED_COLS;

const sidebarsIn = (panes, tabId) => panes.filter((p) => p.tab_id === tabId && isOurs(p));

function rightmostPane(layout, avoid = []) {
  const panes = layout.panes.filter((p) => !avoid.includes(p.pane_id));
  if (!panes.length) return null;
  const rightEdge = Math.max(...panes.map((p) => p.rect.x + p.rect.width));
  const onEdge = panes.filter((p) => p.rect.x + p.rect.width === rightEdge);
  onEdge.sort((a, b) => b.rect.height - a.rect.height);
  return onEdge[0];
}

function launchCommand({ paneId, shim = false, view = null } = {}) {
  const args = [];
  if (paneId) args.push('--pane', paneId);
  if (view) args.push('--view', view);

  if (process.argv.includes('--ascii-icons')) args.push('--ascii-icons');
  if (shim && process.platform === 'win32' && fs.existsSync(CMD_SHIM) && !CMD_SHIM.includes(' ')) {
    return [CMD_SHIM, ...args];
  }
  return ['node', JS_ENTRY, ...args];
}

function open({ anchorPane, cwd, cols = defaultCols(), focus = true, shim = false, avoid = [], view = null }) {
  const layout = h.paneLayout(anchorPane);
  const target = rightmostPane(layout, avoid);
  if (!target) throw new Error('no pane left to split for the sidebar');
  const width = target.rect.width;

  const ratio = Math.min(0.95, Math.max(0.2, (width - cols) / width));

  const paneId = h.splitRight(target.pane_id, ratio, cwd);

  h.paneRename(paneId, RESTORED_LABEL);

  h.stampToken(paneId, OWNER_TOKEN, OWNER_TOKEN, String(Math.floor(Date.now() / 1000)), TOKEN_TTL_MS);
  const command = launchCommand({ paneId, shim, view });
  h.paneRun(paneId, ...command);
  if (focus) h.focusPane(paneId);
  return { pane: paneId, ratio: Number(ratio.toFixed(4)), command, targetWidth: width };
}

function ensure({ tabId, panes = h.paneList(), cols = defaultCols(), focus = false }) {
  if (sidebarsIn(panes, tabId).length) return null;
  const inTab = panes.filter((p) => p.tab_id === tabId);
  if (!inTab.length) return null;
  const anchor = inTab.find((p) => p.focused) || inTab[0];

  return open({ anchorPane: anchor.pane_id, cwd: anchor.cwd, cols, focus });
}

const RESTORED_LABEL = 'Launcher';

function orphansIn(panes, tabId) {
  return panes.filter(
    (p) =>
      p.tab_id === tabId &&
      String(p.label || '') === RESTORED_LABEL &&
      !hasPluginTokens(p) &&
      h.paneIsIdleShell(p.pane_id)
  );
}

function onRightEdge(paneId) {
  const view = h.paneLayout(paneId);
  const self = view.panes.find((p) => p.pane_id === paneId);
  if (!self) return false;
  const rightEdge = Math.max(...view.panes.map((p) => p.rect.x + p.rect.width));
  return self.rect.x + self.rect.width === rightEdge;
}

function adopt({ paneId, shim = false }) {
  h.paneRename(paneId, RESTORED_LABEL);
  h.stampToken(paneId, OWNER_TOKEN, OWNER_TOKEN, String(Math.floor(Date.now() / 1000)), TOKEN_TTL_MS);
  const command = launchCommand({ paneId, shim });
  h.paneRun(paneId, ...command);
  return { pane: paneId, command };
}

function maintainSidebarSize(tabId, sidebarPaneId, cols = defaultCols()) {
  try {
    const layout = h.paneLayout(sidebarPaneId);
    if (!layout || layout.zoomed || !layout.splits || !layout.splits.length) return null;
    const sidebarSplit = layout.splits.find(
      (s) => s.direction === 'right' && s.rect.x === layout.area.x && s.rect.width === layout.area.width
    );
    if (!sidebarSplit) return null;
    const targetRatio = Math.max(0.1, Math.min(0.9, (layout.area.width - cols) / layout.area.width));
    const diff = Number((targetRatio - sidebarSplit.ratio).toFixed(4));
    if (Math.abs(diff) >= 0.02) {
      const dir = diff > 0 ? 'right' : 'left';
      h.tryHerdr(['pane', 'resize', '--pane', sidebarPaneId, '--direction', dir, '--amount', String(Math.abs(diff))]);
      return { action: 'resized', diff, ratio: targetRatio };
    }
    return { action: 'noop', ratio: sidebarSplit.ratio };
  } catch (_) {
    return null;
  }
}

function fallbackTerminal({ tabId, sidebarPane, cwd, cols = defaultCols() }) {
  try {
    if (!sidebarPane || !sidebarPane.pane_id) return null;
    const layout = h.paneLayout(sidebarPane.pane_id);
    const areaWidth = (layout && layout.area && layout.area.width) || 80;
    const ratio = Math.min(0.95, Math.max(0.2, (areaWidth - cols) / areaWidth));
    const targetCwd = cwd || sidebarPane.cwd || process.cwd();
    const newPaneId = h.splitLeft(sidebarPane.pane_id, ratio, targetCwd);
    if (newPaneId) {
      h.focusPane(newPaneId);
      return { action: 'fallback-terminal', pane: newPaneId, tab: tabId, cwd: targetCwd };
    }
    return null;
  } catch (_) {
    return null;
  }
}

function reconcileTab({ tabId, panes = h.paneList(), cols = defaultCols() }) {
  const sidebars = sidebarsIn(panes, tabId);
  if (!sidebars.length) return null;
  const sidebar = sidebars[0];
  const inTab = panes.filter((p) => p.tab_id === tabId);
  const workPanes = inTab.filter((p) => !isOurs(p));

  if (workPanes.length === 0) {
    return fallbackTerminal({ tabId, sidebarPane: sidebar, cwd: sidebar.cwd, cols });
  }

  return maintainSidebarSize(tabId, sidebar.pane_id, cols);
}

module.exports = {
  BAR_COLS,
  EXPANDED_COLS,
  RESTORED_LABEL,
  defaultCols,
  TOKEN_TTL_MS,
  sidebarsIn,
  rightmostPane,
  launchCommand,
  open,
  ensure,
  orphansIn,
  onRightEdge,
  adopt,
  maintainSidebarSize,
  fallbackTerminal,
  reconcileTab,
};
