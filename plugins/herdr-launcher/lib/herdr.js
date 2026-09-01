'use strict';

const { spawnSync, spawn } = require('node:child_process');

const BIN = process.env.HERDR_BIN_PATH || 'herdr';

function herdr(args) {
  const res = spawnSync(BIN, args, { encoding: 'utf8', windowsHide: true });
  if (res.error) throw new Error(`spawn ${BIN}: ${res.error.message}`);
  const out = (res.stdout || '').trim();
  if (res.status !== 0) {
    throw new Error(`herdr ${args.join(' ')} exited ${res.status}: ${(res.stderr || out).trim()}`);
  }
  if (!out) return {};
  try {
    const parsed = JSON.parse(out);
    if (parsed && parsed.error) throw new Error(JSON.stringify(parsed.error));
    return parsed.result || parsed;
  } catch (e) {

    return { _raw: out };
  }
}

function tryHerdr(args) {
  try {
    return herdr(args);
  } catch (_) {
    return null;
  }
}

const paneList = () => herdr(['pane', 'list']).panes || [];
const paneCurrent = () => (herdr(['pane', 'current']).pane || null);
const paneLayout = (paneId) => herdr(['pane', 'layout', '--pane', paneId]).layout;

const envArgs = (env) => Object.entries(env || {}).flatMap(([k, v]) => ['--env', `${k}=${v}`]);

function splitPane(targetPane, direction = 'right', ratio = 0.5, cwd, env) {
  const normDir = direction || 'right';
  if (normDir === 'left') {
    const rawRatio = ratio !== null && ratio !== undefined ? Number(ratio) : 0.5;
    const paneId = splitPane(targetPane, 'right', rawRatio, cwd, env);
    paneSwap(targetPane, paneId);
    return paneId;
  }
  if (normDir === 'up') {
    const rawRatio = ratio !== null && ratio !== undefined ? Number(ratio) : 0.5;
    const paneId = splitPane(targetPane, 'down', rawRatio, cwd, env);
    paneSwap(targetPane, paneId);
    return paneId;
  }
  const args = ['pane', 'split', targetPane, '--direction', normDir, '--ratio', String(ratio), '--no-focus'];
  if (cwd) args.push('--cwd', cwd);
  args.push(...envArgs(env));
  const result = herdr(args);
  const id =
    result.pane_id ||
    (result.pane && result.pane.pane_id) ||
    (result._raw && (result._raw.match(/"pane_id":"([^"]+)"/) || [])[1]);
  if (!id) throw new Error(`could not read pane_id from split reply: ${JSON.stringify(result)}`);
  return id;
}

function splitLeft(targetPane, ratio = 0.5, cwd, env) {
  return splitPane(targetPane, 'left', ratio, cwd, env);
}

function splitRight(targetPane, ratio = 0.5, cwd, env) {
  return splitPane(targetPane, 'right', ratio, cwd, env);
}

function splitDown(targetPane, ratio = 0.5, cwd, env) {
  return splitPane(targetPane, 'down', ratio, cwd, env);
}

function focusPane(paneId) {
  tryHerdr(['pane', 'zoom', paneId, '--on']);
  tryHerdr(['pane', 'zoom', paneId, '--off']);
}

const paneRun = (paneId, ...command) => herdr(['pane', 'run', paneId, ...command]);
const paneRename = (paneId, label) => tryHerdr(['pane', 'rename', paneId, label]);
const paneClose = (paneId) => tryHerdr(['pane', 'close', paneId]);

function stampToken(paneId, source, name, value, ttlMs) {
  const args = ['pane', 'report-metadata', paneId, '--source', source, '--token', `${name}=${value}`];
  if (ttlMs) args.push('--ttl-ms', String(ttlMs));
  return tryHerdr(args);
}

const tabList = () => herdr(['tab', 'list']).tabs || [];
const tabClose = (tabId) => tryHerdr(['tab', 'close', tabId]);
const tabRename = (tabId, label) => tryHerdr(['tab', 'rename', tabId, label]);

const paneZoom = (paneId, on) => tryHerdr(['pane', 'zoom', paneId, on ? '--on' : '--off']);

const paneProcessInfo = (paneId) =>
  (tryHerdr(['pane', 'process-info', '--pane', paneId]) || {}).process_info || null;

function paneIsIdleShell(paneId) {
  const info = paneProcessInfo(paneId);
  if (!info || !info.shell_pid) return false;
  const fg = info.foreground_processes || [];
  return fg.length === 0 || (fg.length === 1 && fg[0].pid === info.shell_pid);
}

function paneMove(paneId, { tab, targetPane, split, ratio, newTab, label } = {}) {
  const args = ['pane', 'move', paneId];
  if (newTab) {
    args.push('--new-tab');
    if (label) args.push('--label', label);
  } else {
    args.push('--tab', tab, '--split', split || 'right');
    if (targetPane) args.push('--target-pane', targetPane);
    if (ratio !== undefined && ratio !== null) args.push('--ratio', String(ratio));
  }
  args.push('--no-focus');
  return herdr(args).move_result || {};
}

const paneSwap = (sourcePane, targetPane) =>
  tryHerdr(['pane', 'swap', '--source-pane', sourcePane, '--target-pane', targetPane]);

const agentList = () => (tryHerdr(['agent', 'list']) || {}).agents || [];
const agentFocus = (target) => tryHerdr(['agent', 'focus', target]) !== null;

function agentStart(name, kind, paneId, agentArgs = [], timeoutMs) {
  const args = ['agent', 'start', name, '--kind', kind, '--pane', paneId];
  if (timeoutMs) args.push('--timeout', String(timeoutMs));
  if (agentArgs.length) args.push('--', ...agentArgs);
  return herdr(args);
}

function detachedHerdr(args) {
  const child = spawn(BIN, args, { detached: true, stdio: 'ignore', windowsHide: true });
  child.unref();
}

module.exports = {
  BIN,
  herdr,
  tryHerdr,
  paneList,
  paneCurrent,
  paneLayout,
  envArgs,
  splitPane,
  splitLeft,
  splitRight,
  splitDown,
  focusPane,
  paneRun,
  paneRename,
  paneClose,
  tabList,
  tabClose,
  tabRename,
  paneZoom,
  paneProcessInfo,
  paneIsIdleShell,
  paneMove,
  paneSwap,
  stampToken,
  agentList,
  agentFocus,
  agentStart,
  detachedHerdr,
};
