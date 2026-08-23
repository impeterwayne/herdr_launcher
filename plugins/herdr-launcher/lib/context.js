'use strict';

const fs = require('node:fs');
const path = require('node:path');
const h = require('./herdr');

const OWNER_TOKEN = 'herdr-launcher';

const TOOL_TOKEN = 'herdr-launcher-tool';

const isAgent = (pane) =>
  Boolean(
    pane &&
      pane.tokens &&
      (pane.tokens[`${OWNER_TOKEN}-agent`] ||
        pane.tokens.agent ||
        (pane.tokens[OWNER_TOKEN] && String(pane.tokens[OWNER_TOKEN]).includes('agent')))
  );

const isOurs = (pane) => Boolean(pane && pane.tokens && pane.tokens[OWNER_TOKEN] && !isAgent(pane));

const toolOf = (pane) => (pane && pane.tokens && pane.tokens[TOOL_TOKEN]) || null;

const hasPluginTokens = (pane) => Boolean(pane && pane.tokens && Object.keys(pane.tokens).length);

function resolveContext() {
  const panes = h.paneList();
  const selfId = process.env.HERDR_PANE_ID || null;
  const self = selfId ? panes.find((p) => p.pane_id === selfId) : null;

  let pane = null;

  const activeId = process.env.HERDR_ACTIVE_PANE_ID;
  if (activeId) pane = panes.find((p) => p.pane_id === activeId) || null;

  const tabs = h.tabList();
  const activeTab = tabs.find((t) => t.focused) || (self ? tabs.find((t) => t.tab_id === self.tab_id) : null) || tabs[0];

  if (!pane && activeTab) {
    const inActive = panes.filter((p) => p.tab_id === activeTab.tab_id);
    pane = inActive.find((p) => p.focused && !isOurs(p) && !toolOf(p)) ||
      inActive.find((p) => !isOurs(p) && !toolOf(p)) ||
      inActive.find((p) => p.focused) ||
      inActive[0] ||
      null;
  }

  if (!pane && self && isOurs(self)) {
    const sameTab = panes.filter((p) => p.tab_id === self.tab_id && !isOurs(p));
    pane = sameTab.find((p) => p.focused) || sameTab[0] || null;
  }

  if (!pane && selfId) pane = panes.find((p) => p.pane_id === selfId) || null;

  if (!pane) pane = panes.find((p) => p.focused && !isOurs(p)) || panes.find((p) => p.focused) || null;

  if (pane && (isOurs(pane) || Boolean(toolOf(pane)))) {
    const plain = (list) => list.find((p) => !isOurs(p) && !toolOf(p));
    pane = plain(panes.filter((p) => p.tab_id === pane.tab_id)) || plain(panes) || pane;
  }

  const cwd =
    process.env.HERDR_ACTIVE_PANE_CWD ||
    (pane && pane.cwd) ||
    process.cwd();

  return { pane, panes, tabId: pane ? pane.tab_id : null, cwd, self };
}

function findRepoRoot(dir) {
  let current = path.resolve(dir);
  for (let i = 0; i < 40; i += 1) {
    if (fs.existsSync(path.join(current, '.git'))) return current;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return null;
}

function configDir() {
  const result = h.tryHerdr(['plugin', 'config-dir', OWNER_TOKEN]);
  const raw = result && (result._raw || result.path || result.config_dir);
  const dir = (raw || '').trim().replace(/^\\\\\?\\/, '');
  return dir || path.join(process.env.APPDATA || process.env.HOME || '.', 'herdr', 'plugin-config', OWNER_TOKEN);
}

function readConfig(name, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(path.join(configDir(), name), 'utf8'));
  } catch (_) {
    return fallback;
  }
}

function writeConfig(name, value) {
  const dir = configDir();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), JSON.stringify(value, null, 2), 'utf8');
  return path.join(dir, name);
}

module.exports = {
  OWNER_TOKEN,
  TOOL_TOKEN,
  isAgent,
  isOurs,
  toolOf,
  hasPluginTokens,
  resolveContext,
  findRepoRoot,
  configDir,
  readConfig,
  writeConfig,
};
