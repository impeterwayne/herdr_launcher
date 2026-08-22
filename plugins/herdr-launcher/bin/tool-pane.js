#!/usr/bin/env node
'use strict';
// Host one workspace tool in its own pane.
//
//   node tool-pane.js <tool-key> [--pane <id>] [--ascii-icons]
//
// This is the program bin/tool-launch.js runs in the pane it splits; it is not
// something to start by hand outside herdr (it needs a TTY, and without --pane
// it cannot keep its ownership token fresh or close itself on `q`).
//
// The pane is the tool, and nothing else: no menu above it, no view stack to
// walk back up. `q` and `esc` both close the pane — the tool is finished with,
// and leaving an empty pane behind is exactly the corpse lib/app.js's quit()
// exists to avoid.

const { App, selfPaneId, requireTTY } = require('../lib/app');
const { TOOL_TOKEN } = require('../lib/context');
const { byKey, TOOLS } = require('../lib/views');

const argv = process.argv.slice(2);
const key = argv.find((a) => !a.startsWith('--'));
const tool = key ? byKey(key) : null;

if (!tool) {
  const keys = TOOLS.map((t) => `  ${t.key.padEnd(10)} ${t.label}`).join('\n');
  process.stderr.write(
    `usage: tool-pane.js <tool-key> [--pane <id>]\n\n${keys}\n`
  );
  process.exit(key ? 1 : 0);
}

requireTTY('tool-pane.js');

new App({
  view: tool.view,
  paneId: selfPaneId(),
  // The tool key is the value, so tool-launch.js can tell a Plane pane from a
  // Symlinks one and focus the right one instead of splitting another.
  stamp: { name: TOOL_TOKEN, value: tool.key },
  escapeQuits: true,
  closesPane: true,
}).start();
