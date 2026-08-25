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

  const ratio = Math.min(0.95, Math.max(0.1, (width - cols) / width));

  const paneId = h.splitRight(target.pane_id, ratio, cwd);

  h.paneRename(paneId, RESTORED_LABEL);

  h.stampToken(paneId, OWNER_TOKEN, OWNER_TOKEN, String(Math.floor(Date.now() / 1000)));
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
  h.stampToken(paneId, OWNER_TOKEN, OWNER_TOKEN, String(Math.floor(Date.now() / 1000)));
  const command = launchCommand({ paneId, shim });
  h.paneRun(paneId, ...command);
  return { pane: paneId, command };
}

function maintainSidebarSize(tabId, sidebarPaneId, cols = defaultCols()) {
  try {
    const layout = h.paneLayout(sidebarPaneId);
    if (!layout || layout.zoomed || !layout.splits || !layout.splits.length) return null;
    const sidebarLayoutPane = layout.panes && layout.panes.find((p) => p.pane_id === sidebarPaneId);
    if (!sidebarLayoutPane) return null;

    const candidateSplits = layout.splits.filter(
      (s) =>
        s.direction === 'right' &&
        sidebarLayoutPane.rect.x + sidebarLayoutPane.rect.width === s.rect.x + s.rect.width &&
        sidebarLayoutPane.rect.y >= s.rect.y &&
        sidebarLayoutPane.rect.y + sidebarLayoutPane.rect.height <= s.rect.y + s.rect.height
    );
    if (!candidateSplits.length) return null;
    candidateSplits.sort((a, b) => a.rect.width - b.rect.width);
    const sidebarSplit = candidateSplits[0];

    const targetRatio = Math.max(0.1, Math.min(0.95, (sidebarSplit.rect.width - cols) / sidebarSplit.rect.width));
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
    const ratio = Math.min(0.95, Math.max(0.1, (areaWidth - cols) / areaWidth));
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

  if (sidebars.length > 1) {
    let enriched = sidebars;
    try {
      const layout = h.paneLayout(sidebars[0].pane_id);
      if (layout && Array.isArray(layout.panes)) {
        const rectMap = new Map(layout.panes.map((p) => [p.pane_id, p.rect]));
        enriched = sidebars.map((p) => ({ ...p, rect: rectMap.get(p.pane_id) || null }));
        enriched.sort((a, b) => ((b.rect ? b.rect.x : 0) - (a.rect ? a.rect.x : 0)));
      }
    } catch (_) {}

    const keep = enriched[0];
    for (const s of sidebars) {
      if (s.pane_id !== keep.pane_id) {
        h.paneClose(s.pane_id);
      }
    }
  }

  const freshPanes = h.paneList();
  const inTab = freshPanes.filter((p) => p.tab_id === tabId);
  const activeSidebars = sidebarsIn(inTab, tabId);
  if (!activeSidebars.length) return null;
  const sidebar = activeSidebars[0];
  const workPanes = inTab.filter((p) => !isOurs(p));

  if (workPanes.length === 0) {
    return fallbackTerminal({ tabId, sidebarPane: sidebar, cwd: sidebar.cwd, cols });
  }

  // Rescue any non-sidebar pane that got split into the sidebar's column
  try {
    const layout = h.paneLayout(sidebar.pane_id);
    if (layout && Array.isArray(layout.panes) && !layout.zoomed) {
      const sidebarLayoutPane = layout.panes.find((p) => p.pane_id === sidebar.pane_id);
      if (sidebarLayoutPane) {
        const rightEdge = layout.area.x + layout.area.width;
        const trappedPanes = layout.panes.filter(
          (p) =>
            p.pane_id !== sidebar.pane_id &&
            !isOurs(inTab.find((x) => x.pane_id === p.pane_id)) &&
            p.rect.x + p.rect.width === rightEdge &&
            p.rect.x >= sidebarLayoutPane.rect.x - 2
        );

        if (trappedPanes.length > 0) {
          const validWorkPanes = layout.panes.filter(
            (p) =>
              p.pane_id !== sidebar.pane_id &&
              !trappedPanes.some((tp) => tp.pane_id === p.pane_id)
          );

          for (const trapped of trappedPanes) {
            if (validWorkPanes.length > 0) {
              validWorkPanes.sort((a, b) => (b.rect.x + b.rect.width) - (a.rect.x + a.rect.width));
              const targetWorkPane = validWorkPanes[0];
              h.paneMove(trapped.pane_id, {
                tab: tabId,
                targetPane: targetWorkPane.pane_id,
                split: 'down',
                ratio: 0.5,
              });
            } else {
              const targetRatio = Math.max(0.1, Math.min(0.95, (layout.area.width - cols) / layout.area.width));
              h.paneMove(trapped.pane_id, {
                tab: tabId,
                targetPane: sidebar.pane_id,
                split: 'left',
                ratio: targetRatio,
              });
            }
          }
          return { action: 'rescued-trapped-panes', count: trappedPanes.length };
        }
      }
    }
  } catch (_) {}

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
