#!/usr/bin/env node
'use strict';

const stash = require('../lib/stash');

const argv = process.argv.slice(2);
const dryRun = argv.includes('--dry-run');
const forceEnter = argv.includes('--enter') || argv.includes('--on');
const forceExit = argv.includes('--exit') || argv.includes('--off');

const report = (payload) => process.stdout.write(`${JSON.stringify(payload)}\n`);

function main() {
  const currentOn = stash.isFocusModeOn();

  let targetOn;
  if (forceEnter) targetOn = true;
  else if (forceExit) targetOn = false;
  else targetOn = !currentOn;

  if (dryRun) {
    return report({
      action: targetOn ? 'enter' : 'exit',
      focusMode: targetOn,
    });
  }

  stash.setFocusMode(targetOn);
  return report({
    action: targetOn ? 'entered' : 'exited',
    focusMode: targetOn,
    mode: targetOn ? 'focus' : 'fibonacci',
    description: targetOn
      ? 'Global Focus Mode ON: new agents will open in a new tab everywhere'
      : 'Global Focus Mode OFF: new agents will open in-tab in Fibonacci spiral everywhere',
  });
}

try {
  main();
} catch (err) {
  process.stderr.write(`${err.message}\n`);
  process.exit(1);
}
