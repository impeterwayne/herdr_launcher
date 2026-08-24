#!/usr/bin/env node
'use strict';

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
  stamp: { name: TOOL_TOKEN, value: tool.key },
  escapeQuits: true,
  closesPane: true,
}).start();
