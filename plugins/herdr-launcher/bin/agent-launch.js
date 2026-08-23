#!/usr/bin/env node
'use strict';
// Launch (or jump back to) a coding agent.
//
//   node agent-launch.js <agent-key> [--tab] [--ratio 0.5] [--direction left|right|down|up] [--reuse] [--dry-run]
//
// Every press starts a NEW instance: the name gets a numeric suffix when the
// plain one is taken, so `codex-yolo-wa`, `codex-yolo-wa-2`, and so on can run
// side by side. Pass --reuse for the old jump-back behaviour, where a second
// press focuses the agent that is already running instead of starting another.
//
// `herdr agent start` is used instead of `pane run` on purpose: it waits for
// interactive readiness, registers the agent so herdr's sidebar shows
// working/blocked/done, makes it addressable by name, and lets the installed
// integration resume it after a server restart.
//
// It only works against a native .exe though, which the npm-installed agents
// are not by default — so the pane is created with the PATH `lib/exe.js` hands
// back, and every kind reaches `agent start` the same way.

const path = require('node:path');
const h = require('../lib/herdr');
const { byKey, AGENTS, resolveFibonacciTarget } = require('../lib/agents');
const { resolveContext, OWNER_TOKEN, configDir } = require('../lib/context');
const { resolveLaunch } = require('../lib/exe');
const stash = require('../lib/stash');

function usage(code) {
  const keys = AGENTS.map((a) => `  ${a.key.padEnd(16)} ${a.label}`).join('\n');
  process.stderr.write(
    `usage: agent-launch.js <agent-key> [--tab] [--ratio N] [--direction left|right|down|up] [--reuse] [--dry-run]\n\n${keys}\n`
  );
  process.exit(code);
}

const argv = process.argv.slice(2);
if (!argv.length || argv[0] === '--help' || argv[0] === '-h') usage(argv.length ? 0 : 1);

const agent = byKey(argv[0]);
if (!agent) {
  process.stderr.write(`unknown agent key: ${argv[0]}\n`);
  usage(1);
}

const useTab = argv.includes('--tab');
const reuse = argv.includes('--reuse');
const dryRun = argv.includes('--dry-run');
const ratioArg = argv.indexOf('--ratio');
const customRatio = ratioArg !== -1 && argv[ratioArg + 1] ? Number(argv[ratioArg + 1]) : null;
const dirArg = argv.indexOf('--direction');
const explicitDirection = dirArg !== -1 && argv[dirArg + 1] ? argv[dirArg + 1] : null;

// Synchronous sleep — this is a short-lived CLI with no pending event-loop work.
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

const MAX_NAME = 32;

/** Fold anything into a legal herdr agent name, clipped to `budget` chars. */
function sanitize(raw, budget = MAX_NAME) {
  const folded = raw
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '-')
    .replace(/^[^a-z]+/, '');
  return (folded || 'agent').slice(0, budget).replace(/[-_]+$/, '');
}

/**
 * herdr agent names must match: start with a lowercase letter, then only
 * lowercase letters, digits, '-' or '_', 1-32 chars. Workspace ids like "wC"
 * carry uppercase, so everything gets folded and trimmed here.
 */
const agentName = (key, workspaceId) => sanitize(`${key}-${workspaceId}`);

/**
 * The first unused name in the `<base>`, `<base>-2`, `<base>-3` series.
 *
 * herdr agent names are unique, so starting a second instance under a name that
 * is already registered fails with `agent_name_taken` — the suffix is what lets
 * several copies of the same agent run in one workspace.
 */
function freeName(base, taken) {
  if (!taken.has(base)) return base;
  for (let n = 2; n <= 99; n += 1) {
    const suffix = `-${n}`;
    const candidate = `${sanitize(base, MAX_NAME - suffix.length)}${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
  throw new Error(`99 instances of ${base} already running`);
}

function main() {
  const ctx = resolveContext();
  const workspace = (ctx.pane && ctx.pane.workspace_id) || 'w';
  // Scope the name to the workspace so each project's agents stay distinct.
  const base = agentName(agent.key, workspace);

  const isPlainTerminal = agent.kind === 'terminal' || !agent.kind;
  const agents = isPlainTerminal ? [] : h.agentList();
  const running = agents.find((a) => a.name === base || a.label === base);
  if (reuse && running && !dryRun) {
    if (h.agentFocus(base)) {
      process.stdout.write(`focused ${base}\n`);
      return;
    }
  }

  const existingPanes = ctx.panes || [];
  const taken = new Set([
    ...agents.map((a) => a.name).filter(Boolean),
    ...existingPanes
      .map((p) => {
        const match = String(p.label || '').match(new RegExp(`^${agent.label}(?: #(\\d+))?$`, 'i'));
        if (match) {
          const num = match[1] ? `-${match[1]}` : '';
          return `${base}${num}`;
        }
        return null;
      })
      .filter(Boolean),
  ]);

  const name = freeName(base, taken);

  const instance = (name.match(/-(\d+)$/) || [])[1] || null;
  const label = instance ? `${agent.label} #${instance}` : agent.label;

  const launch = isPlainTerminal
    ? { exe: null, native: true, shim: null, env: {} }
    : resolveLaunch(agent.kind, path.join(configDir(), 'shims'));

  const inStack = stash.isStackModeOn ? stash.isStackModeOn() : stash.isFocusModeOn();
  const shouldOpenInTab = useTab || inStack;

  const tabPanes = (ctx.panes || []).filter((p) => p.tab_id === ctx.tabId);
  const targetInfo = shouldOpenInTab
    ? null
    : resolveFibonacciTarget({
        ctx,
        tabPanes,
        agentList: agents,
        explicitDirection,
        customRatio,
      });

  const plan = {
    agent: agent.key,
    kind: agent.kind,
    args: agent.args,
    name,
    label,
    exe: launch.exe,
    shim: launch.shim,
    env: Object.keys(launch.env),
    mode: shouldOpenInTab ? 'tab' : 'split',
    direction: shouldOpenInTab ? null : targetInfo.direction,
    cwd: ctx.cwd,
    target: shouldOpenInTab ? null : (targetInfo.targetPane ? targetInfo.targetPane.pane_id : null),
    ratio: shouldOpenInTab ? null : targetInfo.ratio,
    alreadyRunning: Boolean(running),
    stackMode: inStack,
    focusMode: inStack,
  };

  if (dryRun) {
    process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
    return;
  }

  let paneId;
  if (shouldOpenInTab) {
    const created = h.herdr([
      'tab',
      'create',
      '--cwd',
      ctx.cwd,
      '--label',
      label,
      '--focus',
      ...h.envArgs(launch.env),
    ]);
    const tabId = created.tab_id || (created.tab && created.tab.tab_id);
    const panes = h.paneList().filter((p) => p.tab_id === tabId);
    paneId = (panes.find((p) => p.focused) || panes[0] || {}).pane_id;
    if (!paneId) throw new Error(`tab ${tabId} created but no pane found in it`);
  } else {
    if (!targetInfo.targetPane) throw new Error('no active pane to split — open a pane first');
    paneId = h.splitPane(targetInfo.targetPane.pane_id, targetInfo.direction, targetInfo.ratio, ctx.cwd, launch.env);
    h.focusPane(paneId);
  }

  h.paneRename(paneId, label);
  h.stampToken(paneId, OWNER_TOKEN, `${OWNER_TOKEN}-agent`, agent.key);

  if (isPlainTerminal) {
    process.stdout.write(`started ${label} in ${paneId}\n`);
    return;
  }

  // The freshly spawned shell may not have printed its prompt yet; agent start
  // needs an interactive prompt to type into, so allow one retry.
  //
  // `agent start` can report a non-zero exit even when it DID launch the agent
  // (it also waits for a readiness state, and an agent that opens on a trust
  // prompt reports Blocked). So after any failure, ask herdr whether the agent
  // is registered before doing anything else — retrying blindly earns
  // "agent_name_taken", and falling back blindly stacks a second agent process
  // in the same pane.
  const registered = () => h.agentList().some((a) => a.name === name);

  sleep(500);
  let lastError = null;
  for (const wait of [0, 1500]) {
    if (wait) sleep(wait);
    try {
      h.agentStart(name, agent.kind, paneId, agent.args);
      lastError = null;
      break;
    } catch (err) {
      lastError = err;
      if (registered()) {
        lastError = null;
        break;
      }
    }
  }

  const flags = agent.args.length ? ` ${agent.args.join(' ')}` : '';
  if (lastError) {
    // Genuinely not registered: run it in the shell so the user still gets their
    // agent, just without herdr's lifecycle tracking.
    const command = [agent.kind, ...agent.args].join(' ');
    h.paneRun(paneId, command);
    process.stderr.write(
      `agent start failed (${lastError.message.split('\n')[0]}); ran "${command}" directly in ${paneId}\n`
    );
    return;
  }
  process.stdout.write(`started ${name} (${agent.kind}${flags}) in ${paneId}\n`);
}

try {
  main();
} catch (err) {
  process.stderr.write(`${err.message}\n`);
  process.exit(1);
}
