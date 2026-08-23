'use strict';

const { readConfig, writeConfig } = require('./context');

const STATE_FILE = 'stack-mode.json';
const LEGACY_STATE_FILE = 'focus-mode.json';

const readState = () => {
  let state = readConfig(STATE_FILE);
  if (!state) {
    state = readConfig(LEGACY_STATE_FILE);
  }
  const val = state && typeof state.stackMode === 'boolean'
    ? state.stackMode
    : (state && typeof state.focusMode === 'boolean' ? state.focusMode : false);
  return { version: 1, ...(state || {}), stackMode: val, focusMode: val };
};

const writeState = (state) => {
  writeConfig(STATE_FILE, state);
  writeConfig(LEGACY_STATE_FILE, state);
};

const isStackModeOn = () => {
  return Boolean(readState().stackMode);
};
const isFocusModeOn = isStackModeOn;

function setStackMode(on) {
  const state = readState();
  state.stackMode = Boolean(on);
  state.focusMode = Boolean(on);
  state.updatedAt = new Date().toISOString();
  writeState(state);
  return state.stackMode;
}
const setFocusMode = setStackMode;

function toggle({ dryRun = false } = {}) {
  const currentOn = isStackModeOn();
  const nextOn = !currentOn;

  if (dryRun) {
    return {
      action: nextOn ? 'enter' : 'exit',
      stackMode: nextOn,
      focusMode: nextOn,
    };
  }

  setStackMode(nextOn);
  return {
    action: nextOn ? 'entered' : 'exited',
    stackMode: nextOn,
    focusMode: nextOn,
  };
}

module.exports = {
  STATE_FILE,
  readState,
  writeState,
  isStackModeOn,
  isFocusModeOn,
  setStackMode,
  setFocusMode,
  toggle,
};
