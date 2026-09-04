'use strict';

// Is a launcher actually running inside a pane?
//
// herdr's `pane process-info` cannot answer that on Windows: it reports the
// pane's shell and never the shell's children, so `paneIsIdleShell()` calls a
// pane with a live launcher TUI in it "an idle shell". Adopting such a pane
// re-runs the launch command, and `pane run` types that command into the pane's
// TTY — where the running TUI reads it as key events. The path characters move
// the selection and the trailing CR activates it, which is how a startup pass
// ends up spawning agent panes; each spawned pane fires another layout event,
// another reconcile, another "adopt", another agent.
//
// So the launcher reports its own liveness instead: it writes a record for its
// pane while it runs and deletes it on exit, and dock claims a record just
// before it types a launch command so a launcher that is still booting is not
// launched a second time.

const fs = require('node:fs');
const path = require('node:path');
const { configDir } = require('./context');

// A launcher gets this long to boot (node on Windows is not fast) before an
// unfinished claim is treated as a launch that never came up.
const BOOT_GRACE_MS = 20000;
// Heartbeat cadence of a running launcher, and how stale a beat may get before
// the record is only kept alive by the pid still existing.
const BEAT_INTERVAL_MS = 5000;
const BEAT_STALE_MS = 20000;
// A live pid whose heartbeat stopped this long ago is not our launcher any more
// (the process id was recycled), so the pane may be adopted again.
const HUNG_GRACE_MS = 120000;

let cachedDir = null;

function recordDir() {
  if (!cachedDir) cachedDir = path.join(configDir(), 'panes');
  return cachedDir;
}

const recordFile = (paneId) => path.join(recordDir(), `${String(paneId).replace(/[^A-Za-z0-9_-]/g, '_')}.json`);

function read(paneId) {
  if (!paneId) return null;
  try {
    return JSON.parse(fs.readFileSync(recordFile(paneId), 'utf8'));
  } catch (_) {
    return null;
  }
}

function write(paneId, record) {
  try {
    fs.mkdirSync(recordDir(), { recursive: true });
    fs.writeFileSync(recordFile(paneId), JSON.stringify(record), 'utf8');
    return true;
  } catch (_) {
    return false;
  }
}

/** Record that a launch command is about to be typed into `paneId`. */
function claim(paneId) {
  if (!paneId) return false;
  return write(paneId, { pane: paneId, launchedAt: Date.now(), pid: null, ppid: null, beatAt: null });
}

/** Called by a running launcher to say "still here, in this pane". */
function heartbeat(paneId) {
  if (!paneId) return false;
  const prev = read(paneId) || {};
  return write(paneId, {
    pane: paneId,
    launchedAt: prev.launchedAt || Date.now(),
    pid: process.pid,
    ppid: process.ppid || null,
    beatAt: Date.now(),
  });
}

/** Called by a launcher on the way out so its pane can be re-adopted at once. */
function release(paneId) {
  if (!paneId) return false;
  const record = read(paneId);
  if (record && record.pid && record.pid !== process.pid) return false;
  try {
    fs.unlinkSync(recordFile(paneId));
    return true;
  } catch (_) {
    return false;
  }
}

function pidAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}

/**
 * 'live'    — a launcher process is running in this pane
 * 'booting' — a launch command was typed and the launcher has not reported in yet
 * 'dead'    — a record exists but nothing is running behind it
 * 'unknown' — no record at all (a pane restored from an earlier herdr session)
 *
 * Pass `shellPid` (from `pane process-info`) when it is already at hand: it
 * distinguishes our launcher from an unrelated process that inherited the
 * recorded pid after a restart, since pane ids are reused across sessions.
 */
function state(paneId, { shellPid = null } = {}) {
  const record = read(paneId);
  if (!record) return 'unknown';
  const now = Date.now();

  if (record.pid && pidAlive(record.pid)) {
    // `pane run` makes the launcher a child of the pane shell; a launcher started
    // as the pane's own command IS the shell process. Anything else belongs to
    // another pane, which means this record is stale.
    if (shellPid && record.ppid && record.pid !== shellPid && record.ppid !== shellPid) return 'dead';
    if (!record.beatAt || now - record.beatAt < BEAT_STALE_MS) return 'live';
    // Heartbeat stopped but the process is still there: a stopped or starved
    // launcher is still reading stdin, so typing into its pane is not safe.
    if (now - record.beatAt < HUNG_GRACE_MS) return 'live';
    return 'dead';
  }

  if (!record.pid && now - (record.launchedAt || 0) < BOOT_GRACE_MS) return 'booting';
  return 'dead';
}

/** True when a launcher is running, or on its way up, in this pane. */
const isBusy = (paneId, opts) => {
  const current = state(paneId, opts);
  return current === 'live' || current === 'booting';
};

/** Drop records for panes that no longer exist. */
function prune(paneIds = []) {
  const keep = new Set(paneIds.map((id) => path.basename(recordFile(id))));
  const dropped = [];
  let entries = [];
  try {
    entries = fs.readdirSync(recordDir());
  } catch (_) {
    return dropped;
  }
  for (const entry of entries) {
    if (!entry.endsWith('.json') || keep.has(entry)) continue;
    try {
      fs.unlinkSync(path.join(recordDir(), entry));
      dropped.push(entry.replace(/\.json$/, ''));
    } catch (_) {

    }
  }
  return dropped;
}

module.exports = {
  BOOT_GRACE_MS,
  BEAT_INTERVAL_MS,
  BEAT_STALE_MS,
  HUNG_GRACE_MS,
  recordDir,
  read,
  claim,
  heartbeat,
  release,
  pidAlive,
  state,
  isBusy,
  prune,
};
