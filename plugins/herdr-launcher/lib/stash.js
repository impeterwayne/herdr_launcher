'use strict';

const h = require('./herdr');
const layout = require('./layout');
const dock = require('./dock');
const { readConfig, writeConfig } = require('./context');

const STATE_FILE = 'focus-mode.json';

const STASH_LABEL = 'launcher stash';

const isStashTab = (label) => String(label || '') === STASH_LABEL;

const readState = () => {
  const state = readConfig(STATE_FILE);
  return state && state.tabs ? state : { version: 1, tabs: {} };
};

const writeState = (state) => writeConfig(STATE_FILE, state);

const entryFor = (tabId) => readState().tabs[tabId] || null;

function saveEntry(entry) {
  const state = readState();
  state.tabs[entry.tab] = entry;
  writeState(state);
  return entry;
}

function dropEntry(tabId) {
  const state = readState();
  delete state.tabs[tabId];
  writeState(state);
}

function prune(panes = h.paneList(), tabs = h.tabList()) {
  const state = readState();
  const alive = new Set(panes.map((p) => p.pane_id));
  const tabIds = new Set(tabs.map((t) => t.tab_id));
  const dropped = [];
  let changed = false;

  for (const [tabId, entry] of Object.entries(state.tabs)) {
    const stashedAlive = (entry.stashed || []).filter((id) => alive.has(id));
    if (!tabIds.has(tabId) || !stashedAlive.length) {
      dropped.push({ tab: tabId, reason: tabIds.has(tabId) ? 'stash is empty' : 'tab is gone' });
      delete state.tabs[tabId];
      changed = true;
      continue;
    }
    if (stashedAlive.length !== (entry.stashed || []).length) {
      entry.stashed = stashedAlive;
      state.tabs[tabId] = entry;
      changed = true;
    }
  }
  if (changed) writeState(state);
  return dropped;
}

function enter({ workPane, sidebarPane, tabId, workspaceId, dryRun = false }) {
  const existing = entryFor(tabId);
  if (existing) return { action: 'noop', reason: 'already in focus mode', entry: existing };

  const view = h.paneLayout(workPane);
  const tree = layout.record(view);
  if (!tree) return { action: 'refused', reason: 'could not record this tab layout' };
  if (tree.pane) return { action: 'noop', reason: 'one pane in this tab, nothing to stash' };

  const known = new Set(layout.leaves(tree));
  if (!known.has(workPane) || !known.has(sidebarPane)) {
    return { action: 'refused', reason: 'the work pane or the launcher is not in the recorded tree' };
  }

  const stash = [...known].filter((id) => id !== workPane && id !== sidebarPane);
  if (!stash.length) return { action: 'noop', reason: 'nothing beside the work pane to stash' };

  const area = view.area;
  const sidebarRect = (view.panes.find((p) => p.pane_id === sidebarPane) || {}).rect;
  const sidebarCols = (sidebarRect && sidebarRect.width) || dock.defaultCols();
  const workRatio = Math.max(0.05, Math.min(0.95, (area.width - sidebarCols) / area.width));

  if (dryRun) {
    return {
      action: 'enter',
      tab: tabId,
      work: workPane,
      sidebar: sidebarPane,
      stash,
      sidebarCols,
      workRatio: Number(workRatio.toFixed(4)),
      wasZoomed: Boolean(view.zoomed),
      tree,
    };
  }

  if (view.zoomed) h.paneZoom(workPane, false);

  const first = h.paneMove(sidebarPane, { newTab: true, label: STASH_LABEL });
  const stashTab = (first.pane && first.pane.tab_id) || null;
  if (!stashTab) throw new Error('pane move --new-tab did not say which tab it made');

  const entry = saveEntry({
    version: 1,
    tab: tabId,
    workspace: workspaceId || null,
    work: workPane,
    sidebar: sidebarPane,
    sidebarParked: true,
    stashTab,
    stashed: [],
    sidebarCols,
    tree,
    at: new Date().toISOString(),
  });

  for (const paneId of stash) {
    h.paneMove(paneId, { tab: stashTab, split: 'right' });
    entry.stashed.push(paneId);
    saveEntry(entry);
  }

  h.paneMove(sidebarPane, {
    tab: tabId,
    targetPane: workPane,
    split: 'right',
    ratio: workRatio,
  });
  entry.sidebarParked = false;
  saveEntry(entry);

  h.focusPane(workPane);
  return { action: 'entered', ...entry };
}

function reinstateAnchor(entry, paneId, tabPanes) {
  const target = tabPanes.length ? tabPanes[tabPanes.length - 1].pane_id : null;
  h.paneMove(paneId, { tab: entry.tab, targetPane: target, split: 'right', ratio: 0.5 });
  return paneId;
}

function exit(entry, { dryRun = false } = {}) {
  const panes = h.paneList();
  const alive = new Set(panes.map((p) => p.pane_id));
  const tabAlive = h.tabList().some((t) => t.tab_id === entry.tab);
  const stashed = (entry.stashed || []).filter((id) => alive.has(id));

  if (!stashed.length) {
    if (!dryRun) dropEntry(entry.tab);
    return { action: 'cleared', reason: 'nothing left in the stash', tab: entry.tab };
  }
  if (!tabAlive) {

    if (!dryRun) {
      h.tabRename(entry.stashTab, 'restored');
      dropEntry(entry.tab);
    }
    return {
      action: 'cleared',
      reason: 'the tab is gone; stashed panes left in a tab of their own',
      tab: entry.tab,
      stashTab: entry.stashTab,
      panes: stashed,
    };
  }

  const inTab = panes.filter((p) => p.tab_id === entry.tab);

  const treeLeaves = new Set(layout.leaves(entry.tree));
  const usable = (id) => Boolean(id) && alive.has(id) && treeLeaves.has(id);
  const treeInTab = inTab.map((p) => p.pane_id).filter(usable);

  const park =
    usable(entry.sidebar) &&
    treeInTab.includes(entry.sidebar) &&
    treeInTab.some((id) => id !== entry.sidebar);

  const wanted =
    [entry.work, ...treeInTab].find((id) => usable(id) && !(park && id === entry.sidebar)) ||
    stashed[0];

  if (dryRun) {
    return {
      action: 'exit',
      tab: entry.tab,
      anchor: wanted,
      restoring: stashed,
      parkingLauncher: park,
      ops: layout.replay(entry.tree, wanted, { tabId: entry.tab, alive, dryRun: true }),
    };
  }

  if (park) h.paneMove(entry.sidebar, { tab: entry.stashTab, split: 'right' });

  const anchor = inTab.some((p) => p.pane_id === wanted)
    ? wanted
    : reinstateAnchor(entry, wanted, inTab);

  const ops = layout.replay(entry.tree, anchor, { tabId: entry.tab, alive });

  dropEntry(entry.tab);
  h.focusPane(anchor);

  const leftBehind = h
    .paneList()
    .filter((p) => p.tab_id === entry.stashTab)
    .map((p) => p.pane_id);

  return { action: 'exited', tab: entry.tab, anchor, ops, leftBehind };
}

module.exports = {
  STATE_FILE,
  STASH_LABEL,
  isStashTab,
  readState,
  writeState,
  entryFor,
  saveEntry,
  dropEntry,
  prune,
  enter,
  reinstateAnchor,
  exit,
};
