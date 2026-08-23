#!/usr/bin/env node
'use strict';

const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const TEST_SCRIPT = path.join(ROOT, 'plugins', 'herdr-launcher', 'test', 'self-test.js');

const res = spawnSync(process.execPath, [TEST_SCRIPT, ...process.argv.slice(2)], {
  cwd: path.dirname(TEST_SCRIPT),
  stdio: 'inherit',
});

process.exit(res.status ?? 0);
