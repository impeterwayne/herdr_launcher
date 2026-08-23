'use strict';

const { readConfig, writeConfig } = require('./context');

const STATE_FILE = 'focus-mode.json';

const readState = () => {
  const state = readConfig(STATE_FILE);
  return state && typeof state.focusMode === 'boolean' ? state : { version: 1, focusMode: false };
};

const writeState = (state) => writeConfig(STATE_FILE, state);

const isFocusModeOn = () => {
  return Boolean(readState().focusMode);
};

function setFocusMode(on) {
  const state = readState();
  state.focusMode = Boolean(on);
  state.updatedAt = new Date().toISOString();
  writeState(state);
  return state.focusMode;
}

function toggle({ dryRun = false } = {}) {
  const currentOn = isFocusModeOn();
  const nextOn = !currentOn;

  if (dryRun) {
    return {
      action: nextOn ? 'enter' : 'exit',
      focusMode: nextOn,
    };
  }

  setFocusMode(nextOn);
  return {
    action: nextOn ? 'entered' : 'exited',
    focusMode: nextOn,
  };
}

module.exports = {
  STATE_FILE,
  readState,
  writeState,
  isFocusModeOn,
  setFocusMode,
  toggle,
};
