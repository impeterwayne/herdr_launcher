'use strict';

const h = require('./herdr');
const { isOurs, toolOf } = require('./context');
const { defaultCols } = require('./dock');

const isFocusModeOn = (tabId, anchorPaneId = null) => {
  try {
    const paneId = anchorPaneId || (h.paneList().find(p => p.tab_id === tabId) || {}).pane_id;
    if (!paneId) return false;
    const layout = h.paneLayout(paneId);
    return Boolean(layout && layout.zoomed);
  } catch (_) {
    return false;
  }
};

function resetFibonacciSplits(tabId, anchorPaneId) {
  try {
    const layout = h.paneLayout(anchorPaneId);
    if (!layout || !layout.splits) return;
    const panes = h.paneList().filter((p) => p.tab_id === tabId);
    const isSidebar = (p) => isOurs(p);
    const sidebarPane = panes.find(isSidebar);

    // 1. Maintain Sidebar Split at default columns
    let sidebarSplit = null;
    if (sidebarPane) {
      const sidebarLayoutPane = layout.panes && layout.panes.find((p) => p.pane_id === sidebarPane.pane_id);
      if (sidebarLayoutPane) {
        const candidateSplits = layout.splits.filter(
          (s) =>
            s.direction === 'right' &&
            sidebarLayoutPane.rect.x + sidebarLayoutPane.rect.width === s.rect.x + s.rect.width &&
            sidebarLayoutPane.rect.y >= s.rect.y &&
            sidebarLayoutPane.rect.y + sidebarLayoutPane.rect.height <= s.rect.y + s.rect.height
        );
        if (candidateSplits.length) {
          candidateSplits.sort((a, b) => a.rect.width - b.rect.width);
          sidebarSplit = candidateSplits[0];
          const targetRatio = Math.max(0.1, Math.min(0.95, (sidebarSplit.rect.width - defaultCols()) / sidebarSplit.rect.width));
          const diff = Number((targetRatio - sidebarSplit.ratio).toFixed(4));
          if (Math.abs(diff) >= 0.02) {
            const dir = diff > 0 ? 'right' : 'left';
            h.tryHerdr(['pane', 'resize', '--pane', sidebarPane.pane_id, '--direction', dir, '--amount', String(Math.abs(diff))]);
          }
        }
      }
    }

    // 2. Reset all other splits to balanced 0.5 (Fibonacci)
    const workSplits = layout.splits.filter((s) => {
      if (sidebarSplit && s.id === sidebarSplit.id) return false;
      return true;
    });

    for (const split of workSplits) {
      const paneInSplit = panes.find((p) => {
        const pr = (layout.panes.find((lp) => lp.pane_id === p.pane_id) || {}).rect;
        if (!pr) return false;
        return pr.x >= split.rect.x && pr.y >= split.rect.y &&
          pr.x + pr.width <= split.rect.x + split.rect.width &&
          pr.y + pr.height <= split.rect.y + split.rect.height;
      });
      if (!paneInSplit) continue;
      const diff = Number((0.5 - split.ratio).toFixed(4));
      if (Math.abs(diff) >= 0.02) {
        const dir = diff > 0 ? (split.direction === 'right' ? 'right' : 'down') : (split.direction === 'right' ? 'left' : 'up');
        h.tryHerdr(['pane', 'resize', '--pane', paneInSplit.pane_id, '--direction', dir, '--amount', String(Math.abs(diff))]);
      }
    }
  } catch (_) {}
}

function applyFocusMode({ tabId, focusedPaneId = null, focusModeOn = false }) {
  const panes = h.paneList().filter((p) => p.tab_id === tabId);
  if (!panes.length) return { action: 'noop', reason: 'no panes in tab' };

  const anchor = focusedPaneId
    ? panes.find((p) => p.pane_id === focusedPaneId) || panes[0]
    : panes.find((p) => p.focused) || panes[0];

  if (focusModeOn) {
    // Zoom the focused pane (100% full screen zoom, no slivers)
    h.paneZoom(anchor.pane_id, true);
  } else {
    // Unzoom and restore balanced Fibonacci splits
    h.paneZoom(anchor.pane_id, false);
    resetFibonacciSplits(tabId, anchor.pane_id);
    h.focusPane(anchor.pane_id);
  }

  return {
    action: focusModeOn ? 'focus-on' : 'focus-off',
    tab: tabId,
    activePane: anchor.pane_id,
    zoomed: Boolean(focusModeOn),
  };
}

const applyStackMode = applyFocusMode;
const isStackModeOn = isFocusModeOn;

module.exports = {
  isStackModeOn,
  isFocusModeOn,
  resetFibonacciSplits,
  applyStackMode,
  applyFocusMode,
};
