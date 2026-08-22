#!/usr/bin/env node
'use strict';
// Keep a launcher sidebar in every tab.
//
//   node watch-tabs.js            # subscribe and dock, in the foreground
//   node watch-tabs.js --start    # spawn that watcher detached, then exit
//   node watch-tabs.js --stop
//   node watch-tabs.js --status
//   node watch-tabs.js --once     # dock every tab that has no sidebar, then exit
//
// WHY A WATCHER AND NOT AN [[events]] HOOK. A manifest hook spawns a fresh
// process per event, and on Windows 11 any console-subsystem process in a hook
// chain flashes a Windows Terminal window — once per tab creation here, and once
// per focus change for the hooks you actually want. One long-lived subscriber
// spawns nothing on the hot path: it holds the socket open, and the herdr CLI
// children it does run are console programs started with windowsHide.
//
// Only one watcher may run at a time. The pid file is the lock, and it is taken
// with an EXCLUSIVE create rather than a check-then-write: two --start calls in
// the same breath (a keybinding and a sidebar opening, say) would otherwise both
// see an empty slot, both spawn, and the second would overwrite the first's pid
// and orphan it. A watcher also re-reads the lock every 30s and exits if it no
// longer names it, so an orphan that predates this cannot outlive a --stop.
//
// Docking is idempotent per tab (a tab that already carries our token is
// skipped), and the event path additionally refuses any tab that already holds
// more than its root pane — which is what makes the replayed tab.created that
// arrives right after subscribing harmless.

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const api = require('../lib/api');
const dock = require('../lib/dock');
const h = require('../lib/herdr');
const { configDir } = require('../lib/context');

const SELF = path.join(__dirname, 'watch-tabs.js');
const argv = process.argv.slice(2);
const colsArg = argv.indexOf('--cols');
const cols = colsArg !== -1 && argv[colsArg + 1] ? Number(argv[colsArg + 1]) : dock.defaultCols();

const pidFile = () => path.join(configDir(), 'watch-tabs.pid');
const logFile = () => path.join(configDir(), 'watch-tabs.log');

/**
 * One line to stdout, which for the detached watcher IS watch-tabs.log (see
 * start()). Appending to the file here as well would double every line.
 */
function log(message) {
  process.stdout.write(`${new Date().toISOString()} ${message}\n`);
}

/** Block this process for `ms`. Only used by --start, which has nothing else to do. */
function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** The pid in the lock file, if a process is still answering to it. */
function runningPid() {
  let pid;
  try {
    pid = Number(fs.readFileSync(pidFile(), 'utf8').trim());
  } catch (_) {
    return null;
  }
  if (!pid || pid === process.pid) return null;
  try {
    process.kill(pid, 0); // signal 0 only asks whether it exists
    return pid;
  } catch (_) {
    return null;
  }
}

/**
 * Take the lock, or return false if someone else holds it. `wx` is the whole
 * point: the create fails when the file is already there, so two watchers
 * starting at once cannot both believe they won.
 */
function claimLock() {
  fs.mkdirSync(configDir(), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      fs.writeFileSync(pidFile(), String(process.pid), { encoding: 'utf8', flag: 'wx' });
      break;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      if (runningPid()) return false;
      try {
        fs.unlinkSync(pidFile()); // stale: the pid in it is gone
      } catch (_) {
        /* someone else just cleaned it up */
      }
    }
  }

  const release = () => {
    try {
      if (Number(fs.readFileSync(pidFile(), 'utf8').trim()) === process.pid) fs.unlinkSync(pidFile());
    } catch (_) {
      /* nothing to release */
    }
  };
  process.on('exit', release);
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.on(signal, () => process.exit(0));
  }

  // A kill on Windows does not run the victim's exit handler, so a stale pid
  // file is normal and someone else may legitimately take the lock. Noticing
  // that and standing down is what keeps orphans from docking panes forever.
  setInterval(() => {
    let owner = null;
    try {
      owner = Number(fs.readFileSync(pidFile(), 'utf8').trim());
    } catch (_) {
      owner = null;
    }
    if (owner !== process.pid) {
      log(`lock now held by ${owner === null ? 'nobody' : owner} — standing down`);
      process.exit(0);
    }
  }, 30000);
  return true;
}

/**
 * Dock a sidebar into `tabId` unless it already has one.
 *
 * `requireFresh` is for the event path: dock only while the tab still holds
 * nothing but its root pane. The event's own pane_count says the same thing, but
 * this is measured now rather than when the event was emitted, and it is the
 * check that keeps a stray or replayed event from splitting a layout somebody
 * has built. `--once` deliberately does not pass it.
 */
function dockTab(tabId, why, { requireFresh = false } = {}) {
  let panes;
  try {
    panes = h.paneList();
  } catch (err) {
    log(`skip ${tabId}: ${err.message.split('\n')[0]}`);
    return;
  }
  const inTab = panes.filter((p) => p.tab_id === tabId);
  if (!inTab.length) return; // closed again already
  if (requireFresh && inTab.length > 1) {
    log(`skip ${tabId}: ${inTab.length} panes, not a fresh tab`);
    return;
  }
  try {
    const result = dock.ensure({ tabId, panes, cols, focus: false });
    if (result) log(`docked ${result.pane} in ${tabId} (${why})`);
  } catch (err) {
    log(`failed ${tabId}: ${err.message.split('\n')[0]}`);
  }
}

/** Dock every tab that has no sidebar yet. */
function dockAll(why) {
  const panes = h.paneList();
  const tabs = [...new Set(panes.map((p) => p.tab_id))];
  for (const tabId of tabs) dockTab(tabId, why);
}

function watch() {
  const holder = runningPid();
  if (holder) {
    process.stdout.write(`already running (pid ${holder})\n`);
    return;
  }
  if (!claimLock()) {
    process.stdout.write(`already running (pid ${runningPid()})\n`);
    return;
  }
  log(`watching tab.created via ${api.socketPath()}`);

  let attempt = 0;
  const open = () => {
    let ready = false;
    api.subscribe(
      ['tab.created'],
      (envelope) => {
        const tab = envelope.data && envelope.data.tab;
        if (!tab || !tab.tab_id) return;
        // Subscribing REPLAYS the last tab.created, so the first event after a
        // start is usually about a tab that has been open for a while. A tab
        // this event is really announcing still has nothing but its root pane,
        // which is the one thing the replay cannot fake — and it doubles as a
        // rule against carving up a layout somebody has already built.
        if (tab.pane_count > 1) {
          log(`skip ${tab.tab_id}: ${tab.pane_count} panes, not a new tab`);
          return;
        }
        // A brand-new tab's root pane exists by the time the event lands, but
        // splitting it in the same breath as herdr finishes wiring the tab has
        // nothing to gain — give the layout a beat, then dock.
        setTimeout(() => dockTab(tab.tab_id, 'tab.created', { requireFresh: true }), 150);
      },
      {
        onReady: () => {
          ready = true;
          attempt = 0;
        },
        onError: (err) => log(`socket error: ${err.message}`),
        onClose: () => {
          if (attempt >= 10) {
            log('herdr is gone — stopping');
            process.exit(0);
          }
          const delay = Math.min(30000, 2 ** attempt * 1000);
          attempt += 1;
          log(`${ready ? 'disconnected' : 'connect failed'}, retrying in ${delay}ms`);
          setTimeout(open, delay);
        },
      }
    );
  };
  open();
}

function start() {
  const existing = runningPid();
  if (existing) return `already running (pid ${existing})`;
  let out = 'ignore';
  try {
    fs.mkdirSync(configDir(), { recursive: true });
    out = fs.openSync(logFile(), 'a');
  } catch (_) {
    /* logging is best-effort */
  }
  const args = [SELF];
  if (colsArg !== -1) args.push('--cols', String(cols));
  const child = spawn(process.execPath, args, {
    detached: true,
    windowsHide: true,
    stdio: ['ignore', out, out],
  });
  child.unref();

  // The daemon writes the pid file only once it has won the lock, and a loser
  // stands down immediately. Wait for that to settle rather than reporting a
  // start that did not happen — two --start calls racing is the normal case
  // (a keybinding and a sidebar opening at once), not an error.
  for (let waited = 0; waited < 500; waited += 50) {
    sleep(50);
    const owner = runningPid();
    if (owner === child.pid) return `started (pid ${child.pid})`;
    if (owner) return `already running (pid ${owner})`;
  }
  return `started (pid ${child.pid})`;
}

function stop() {
  const pid = runningPid();
  if (!pid) {
    // Nothing alive, but a stale file would block the next start.
    try {
      fs.unlinkSync(pidFile());
    } catch (_) {
      /* nothing to clear */
    }
    return 'not running';
  }
  try {
    process.kill(pid);
  } catch (err) {
    return `could not stop ${pid}: ${err.message}`;
  }
  // Windows does not run the victim's exit handler, so clear the lock here
  // rather than trusting it to tidy up after itself.
  try {
    if (Number(fs.readFileSync(pidFile(), 'utf8').trim()) === pid) fs.unlinkSync(pidFile());
  } catch (_) {
    /* already gone */
  }
  return `stopped (pid ${pid})`;
}

try {
  if (argv.includes('--stop')) process.stdout.write(`${stop()}\n`);
  else if (argv.includes('--status')) {
    const pid = runningPid();
    process.stdout.write(`${pid ? `running (pid ${pid})` : 'not running'}\n`);
  } else if (argv.includes('--once')) dockAll('--once');
  else if (argv.includes('--start')) process.stdout.write(`${start()}\n`);
  else watch();
} catch (err) {
  process.stderr.write(`${err.message}\n`);
  process.exit(1);
}
