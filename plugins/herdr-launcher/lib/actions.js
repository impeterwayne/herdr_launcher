'use strict';

const { A, GUTTER, displayWidth } = require('./tui');

const ACTION_ROWS = 2;
const CHIP_GAP = 1;

const KEY_GLYPH = {
  enter: '⏎',
  escape: 'esc',
  up: '↑',
  down: '↓',
  pageup: 'pgup',
  pagedown: 'pgdn',
};

const keyGlyph = (key) => KEY_GLYPH[key] || key;

const chipText = (action) => `[${keyGlyph(action.key)} ${action.label}]`;

const chipStyled = (action) =>
  `${A.gray}[${A.reset}${A.cyan}${keyGlyph(action.key)}${A.reset}${A.gray} ${action.label}]${A.reset}`;

function layoutActions(actions, inner) {
  const rows = [[]];

  for (const action of actions || []) {
    const text = chipText(action);
    const width = displayWidth(text);
    let row = rows[rows.length - 1];
    const used = row.length ? row[row.length - 1].end : 0;
    const start = used ? used + CHIP_GAP : 0;

    if (start + width > inner && row.length) {
      if (rows.length === ACTION_ROWS) break;
      rows.push([]);
      row = rows[rows.length - 1];
      row.push({ action, text, start: 0, end: width });
      continue;
    }
    row.push({ action, text, start, end: start + width });
  }

  const lines = [];
  const hits = [];
  const pad = ' '.repeat(GUTTER);

  rows.forEach((row, index) => {
    if (!row.length) return lines.push('');
    let line = '';
    let col = 0;
    for (const chip of row) {
      line += ' '.repeat(chip.start - col) + chipStyled(chip.action);
      col = chip.end;
      hits.push({
        row: index,
        x1: GUTTER + chip.start + 1,
        x2: GUTTER + chip.end,
        key: chip.action.key,
      });
    }
    return lines.push(`${pad}${line}`);
  });

  while (lines.length < ACTION_ROWS) lines.push('');
  return { lines, hits };
}

module.exports = { ACTION_ROWS, CHIP_GAP, KEY_GLYPH, keyGlyph, chipText, layoutActions };
