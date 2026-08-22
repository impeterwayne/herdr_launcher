'use strict';

const ESC = '\x1b';
const A = {
  reset: `${ESC}[0m`,
  bold: `${ESC}[1m`,
  dim: `${ESC}[2m`,
  rev: `${ESC}[7m`,
  red: `${ESC}[31m`,
  green: `${ESC}[32m`,
  yellow: `${ESC}[33m`,
  cyan: `${ESC}[36m`,
  gray: `${ESC}[90m`,
};

const GUTTER = 1;
const BADGE_W = 2;
const HINT_GAP = 2;

const stripAnsi = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');
const rule = (width, char = '─') => char.repeat(Math.max(0, width));

const WIDE = [
  [0x1100, 0x115f],
  [0x2e80, 0xa4cf],
  [0xac00, 0xd7a3],
  [0xf900, 0xfaff],
  [0xfe30, 0xfe6f],
  [0xff00, 0xff60],
  [0xffe0, 0xffe6],
  [0x1f300, 0x1f64f],
  [0x1f900, 0x1f9ff],
  [0x20000, 0x3fffd],
];
const ZERO = [
  [0x0300, 0x036f],
  [0x200b, 0x200f],
  [0xfe00, 0xfe0f],
  [0xfeff, 0xfeff],
];

const inAny = (ranges, cp) => ranges.some(([a, b]) => cp >= a && cp <= b);
const cellWidth = (cp) => (inAny(ZERO, cp) ? 0 : inAny(WIDE, cp) ? 2 : 1);

function displayWidth(s) {
  let width = 0;
  for (const ch of s) width += cellWidth(ch.codePointAt(0));
  return width;
}

function truncate(s, width) {
  let out = '';
  let used = 0;
  for (const ch of s) {
    const w = cellWidth(ch.codePointAt(0));
    if (used + w > width) break;
    out += ch;
    used += w;
  }
  return out;
}

const clip = (s, max) => (displayWidth(s) > max ? `${truncate(s, Math.max(0, max - 1))}…` : s);

function iconFor(item) {
  if (item.icon) return item.icon;
  const letters = (item.label || '').replace(/[^A-Za-z0-9]/g, '');
  return letters ? letters.slice(0, 2).toUpperCase() : '..';
}

function iconColumn(items) {
  let width = 0;
  for (const item of items) {
    if (item.type !== 'item') continue;
    width = Math.max(width, displayWidth(iconFor(item)));
  }
  return width;
}

function badgeColumn(items) {
  return items.some((item) => item.type === 'item' && item.danger) ? BADGE_W : 0;
}

const padTo = (s, width) => {
  const used = displayWidth(s);
  return used >= width ? truncate(s, width) : s + ' '.repeat(width - used);
};

function fit(s, width) {
  const plain = stripAnsi(s);
  const used = displayWidth(plain);
  if (used === width) return s;
  if (used < width) return s + ' '.repeat(width - used);

  let out = '';
  let visible = 0;
  let i = 0;
  while (i < s.length) {
    if (s[i] === ESC) {
      const end = s.indexOf('m', i);
      if (end === -1) break;
      out += s.slice(i, end + 1);
      i = end + 1;
      continue;
    }
    const ch = String.fromCodePoint(s.codePointAt(i));
    const w = cellWidth(ch.codePointAt(0));
    if (visible + w > width - 1) break;
    out += ch;
    visible += w;
    i += ch.length;
  }
  return `${out}…${A.reset}`;
}

class Screen {
  constructor(out = process.stdout, input = process.stdin) {
    this.out = out;
    this.in = input;
    this.started = false;
  }

  get cols() {
    return this.out.columns || 40;
  }

  get rows() {
    return this.out.rows || 24;
  }

  start() {
    if (this.started) return;
    this.started = true;

    this.out.write(`${ESC}[?1049h${ESC}[?25l${ESC}[?1002h${ESC}[?1006h`);
    if (this.in.isTTY) this.in.setRawMode(true);
    this.in.resume();
    this._resize = () => this._onResizeCb && this._onResizeCb();
    this.out.on('resize', this._resize);
  }

  stop() {
    if (!this.started) return;
    this.started = false;
    if (this._resize) this.out.off('resize', this._resize);
    if (this.in.isTTY) this.in.setRawMode(false);
    this.in.pause();
    this.out.write(`${ESC}[?1006l${ESC}[?1002l${ESC}[?25h${ESC}[?1049l`);
  }

  onResize(cb) {
    this._onResizeCb = cb;
  }

  draw(lines) {
    const buf = [`${ESC}[H`];
    const max = this.rows;
    for (let i = 0; i < max; i += 1) {
      buf.push(`${ESC}[K`);
      if (i < lines.length) buf.push(fit(lines[i], this.cols));
      if (i < max - 1) buf.push('\r\n');
    }
    this.out.write(buf.join(''));
  }
}

const NAMED = {
  '\x03': 'ctrl-c',
  '\r': 'enter',
  '\n': 'enter',
  '\x7f': 'backspace',
  '\b': 'backspace',
  '\t': 'tab',
  '\x0e': 'down',
  '\x10': 'up',
  [`${ESC}`]: 'escape',
  [`${ESC}[A`]: 'up',
  [`${ESC}[B`]: 'down',
  [`${ESC}[C`]: 'right',
  [`${ESC}[D`]: 'left',
  [`${ESC}[5~`]: 'pageup',
  [`${ESC}[6~`]: 'pagedown',
  [`${ESC}[H`]: 'home',
  [`${ESC}[1~`]: 'home',
  [`${ESC}[F`]: 'end',
  [`${ESC}[4~`]: 'end',
};

const SGR_MOUSE = /^\x1b\[<(\d+);(\d+);(\d+)([Mm])/;
const CSI = /^\x1b\[[0-9;?]*[A-Za-z~]/;

function parseKeys(chunk) {
  let rest = chunk.toString('utf8');
  const events = [];

  while (rest.length) {
    const mouse = rest.match(SGR_MOUSE);
    if (mouse) {
      const code = Number(mouse[1]);
      events.push({
        mouse: {
          button: code & 3,
          x: Number(mouse[2]),
          y: Number(mouse[3]),
          pressed: mouse[4] === 'M',
          drag: Boolean(code & 32),
          wheel: code & 64 ? ((code & 1) === 0 ? 'up' : 'down') : null,
        },
      });
      rest = rest.slice(mouse[0].length);
      continue;
    }

    if (NAMED[rest]) {
      events.push(NAMED[rest]);
      break;
    }

    const csi = rest.match(CSI);
    if (csi) {
      events.push(NAMED[csi[0]] || csi[0]);
      rest = rest.slice(csi[0].length);
      continue;
    }

    if (rest[0] === ESC && rest.length === 1) {
      events.push('escape');
      break;
    }

    events.push(NAMED[rest[0]] || rest[0]);
    rest = rest.slice(1);
  }

  return events;
}

class List {
  constructor(items = []) {
    this.items = items;
    this.selected = this.firstSelectable();
    this.scroll = 0;
    this.rowMap = [];

    this.followSelection = true;
  }

  firstSelectable() {
    const i = this.items.findIndex((item) => item.type === 'item' && !item.disabled);
    return i === -1 ? this.items.findIndex((item) => item.type === 'item') : i;
  }

  setItems(items) {
    this.items = items;
    const current = this.items[this.selected];
    if (!current || current.type !== 'item') this.selected = this.firstSelectable();
    this.followSelection = true;
  }

  current() {
    const item = this.items[this.selected];
    return item && item.type === 'item' ? item : null;
  }

  move(delta) {
    let i = this.selected;
    for (let guard = 0; guard <= this.items.length; guard += 1) {
      i += delta;
      if (i < 0 || i >= this.items.length) return;
      if (this.items[i].type === 'item') {
        this.selected = i;
        this.followSelection = true;
        return;
      }
    }
  }

  selectIndex(index) {
    const item = this.items[index];
    if (!item || item.type !== 'item') return null;
    this.selected = index;
    this.followSelection = true;
    return item;
  }

  scrollBy(delta, height) {
    const max = Math.max(0, this.items.length - height);
    this.scroll = Math.min(max, Math.max(0, this.scroll + delta));
    this.followSelection = false;
  }

  viewport(height) {
    if (this.followSelection) {
      if (this.selected < this.scroll) this.scroll = this.selected;
      if (this.selected >= this.scroll + height) this.scroll = this.selected - height + 1;
    }
    this.scroll = Math.min(this.scroll, Math.max(0, this.items.length - height));
    this.scroll = Math.max(0, this.scroll);
    return { from: this.scroll, to: Math.min(this.items.length, this.scroll + height) };
  }

  render(height, width) {
    this.rowMap = [];
    if (height < 1 || width < 8) return [];

    const { from, to } = this.viewport(height);
    const inner = width - GUTTER * 2;
    const iconW = iconColumn(this.items);
    const badgeW = badgeColumn(this.items);

    const prefixW = iconW + 1 + badgeW;
    const lines = [];

    for (let i = from; i < to; i += 1) {
      const item = this.items[i];
      const pad = ' '.repeat(GUTTER);

      if (item.type === 'blank') {
        this.rowMap.push(null);
        lines.push('');
        continue;
      }

      if (item.type === 'group') {
        this.rowMap.push(null);
        const label = clip(item.label, Math.max(0, inner - 4));
        const bar = rule(Math.max(0, inner - displayWidth(label) - 1));
        lines.push(`${pad}${A.gray}${label} ${bar}${A.reset}`);
        continue;
      }

      this.rowMap.push(i);

      const selected = i === this.selected;
      const glyph = padTo(iconFor(item), iconW);
      const badge = badgeW ? `${item.danger ? '!' : ' '} ` : '';
      const labelRoom = inner - prefixW;
      const label = clip(item.label, labelRoom);
      let hint = '';
      if (item.hint) {
        const room = labelRoom - displayWidth(label) - HINT_GAP;
        if (room >= 3) hint = clip(item.hint, room);
      }
      const gap = Math.max(0, labelRoom - displayWidth(label) - displayWidth(hint));
      const plain = `${pad}${glyph} ${badge}${label}${' '.repeat(gap)}${hint}${pad}`;

      if (selected) {

        lines.push(`${A.rev}${padTo(plain, width)}${A.reset}`);
        continue;
      }

      const badgeStyled = badgeW ? (item.danger ? `${A.red}!${A.reset} ` : '  ') : '';
      const glyphColor = item.disabled
        ? A.gray
        : item.iconColor || (item.danger ? A.yellow : A.cyan);
      const glyphStyled = `${glyphColor}${glyph}${A.reset}`;
      const labelStyled = item.disabled
        ? `${A.gray}${label}${A.reset}`
        : item.danger
          ? `${A.yellow}${label}${A.reset}`
          : label;
      lines.push(
        `${pad}${glyphStyled} ${badgeStyled}${labelStyled}${' '.repeat(gap)}${A.gray}${hint}${A.reset}${pad}`
      );
    }

    while (lines.length < height) {
      this.rowMap.push(null);
      lines.push('');
    }
    return lines;
  }
}

module.exports = {
  A,
  ESC,
  GUTTER,
  Screen,
  List,
  parseKeys,
  fit,
  padTo,
  clip,
  truncate,
  rule,
  cellWidth,
  displayWidth,
  iconFor,
  iconColumn,
  badgeColumn,
  stripAnsi,
};
