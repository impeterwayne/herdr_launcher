'use strict';

const path = require('node:path');

const { A, GUTTER, Screen, parseKeys, clip, rule } = require('./tui');
const { ACTION_ROWS, layoutActions } = require('./actions');
const { resolveContext, findRepoRoot, OWNER_TOKEN } = require('./context');
const { TOKEN_TTL_MS } = require('./dock');
const h = require('./herdr');

const STAMP_INTERVAL_MS = 30000;

class App {

  constructor(options = {}) {
    this.options = options;
    this.paneId = options.paneId || null;
    this.screen = new Screen();
    this.view = null;
    this.viewHistory = [];
    this.status = '';
    this.statusKind = 'info';
    this.pending = null;
    this.ctx = { cwd: process.cwd(), pane: null };
    this.running = true;
  }

  refreshContext() {
    try {
      this.ctx = resolveContext();
    } catch (err) {
      this.setStatus(`herdr unavailable: ${err.message.split('\n')[0]}`, 'error');
    }
  }

  setView(view, { pushHistory = true } = {}) {
    if (pushHistory && this.view && this.view !== view) {
      this.viewHistory.push(this.view);
    }
    this.view = view;
    if (view.refresh) view.refresh(this);
    this.render();
  }

  popView() {
    if (this.viewHistory && this.viewHistory.length > 0) {
      const prev = this.viewHistory.pop();
      this.view = prev;
      if (prev.refresh) prev.refresh(this);
      this.render();
      return true;
    }
    return false;
  }

  setStatus(message, kind = 'info') {
    this.status = message;
    this.statusKind = kind;
  }

  activate(item) {
    if (!item || item.disabled || !item.run) return;
    item.run(this);
  }

  confirm(message, onYes) {
    this.pending = { message, onYes };
    this.setStatus(`${message}  [y/n]`, 'error');
  }

  get statusColor() {
    return this.statusKind === 'error' ? A.red : this.statusKind === 'ok' ? A.green : A.gray;
  }

  chrome() {
    const { cols } = this.screen;
    const pad = ' '.repeat(GUTTER);
    const inner = cols - GUTTER * 2;
    const view = this.view;
    const where = path.basename(findRepoRoot(this.ctx.cwd) || this.ctx.cwd || '');

    const header = [
      '',
      `${pad}${A.bold}${A.cyan}${clip(view.title, inner)}${A.reset}`,
      `${pad}${A.gray}${clip(where, inner)}${A.reset}`,
      `${pad}${A.gray}${rule(inner)}${A.reset}`,
      '',
    ];

    const actions = view.actions || this.options.actions || [];
    const bar = layoutActions(actions, inner);

    const footer = [
      '',
      `${pad}${A.gray}${rule(inner)}${A.reset}`,
      this.status ? `${pad}${this.statusColor}${clip(this.status, inner)}${A.reset}` : '',
      ...bar.lines,
    ];

    const offset = footer.length - ACTION_ROWS;
    return { header, footer, hits: bar.hits.map((hit) => ({ ...hit, row: offset + hit.row })) };
  }

  render() {
    const { cols, rows } = this.screen;
    const { header, footer, hits } = this.chrome();
    const bodyHeight = Math.max(1, rows - header.length - footer.length);
    this.bodyTop = header.length;
    this.bodyHeight = bodyHeight;

    const footerTop = header.length + bodyHeight;
    this.actionHits = hits.map((hit) => ({ ...hit, y: footerTop + hit.row + 1 }));
    this.screen.draw([...header, ...this.view.render(bodyHeight, cols), ...footer]);
  }

  handleMouse(ev) {
    if (ev.wheel) {
      this.view.list.scrollBy(ev.wheel === 'up' ? -3 : 3, this.bodyHeight || 1);
      return this.render();
    }
    if (!ev.pressed || ev.drag || ev.button !== 0) return undefined;

    const chip = (this.actionHits || []).find(
      (hit) => hit.y === ev.y && ev.x >= hit.x1 && ev.x <= hit.x2
    );
    if (chip) return this.handleKey(chip.key);

    const bodyRow = ev.y - 1 - (this.bodyTop || 0);
    if (bodyRow < 0 || bodyRow >= (this.bodyHeight || 0)) return undefined;

    const index = this.view.list.rowMap[bodyRow];
    if (index === null || index === undefined) return undefined;

    const focused = index === this.view.list.selected;
    const item = this.view.list.selectIndex(index);
    if (focused || (item && item.singleClick)) this.activate(item);
    return this.render();
  }

  handleKey(key) {
    if (key && key.mouse) {

      return this.pending ? undefined : this.handleMouse(key.mouse);
    }
    if (key === 'ctrl-c') return this.quit();

    if (this.pending) {
      const { onYes } = this.pending;
      this.pending = null;
      if (key === 'y' || key === 'Y') {
        onYes();
      } else {
        this.setStatus('cancelled');
      }
      return this.render();
    }

    if (this.view.onKey && this.view.onKey(key, this) === true) return undefined;

    switch (key) {
      case 'q':
        if (this.popView()) return undefined;
        return this.quit();
      case 'escape':
        if (this.popView()) return undefined;
        return this.options.escapeQuits ? this.quit() : undefined;
      case 'up':
      case 'k':
        this.view.list.move(-1);
        return this.render();
      case 'down':
      case 'j':
        this.view.list.move(1);
        return this.render();
      case 'pageup':
        for (let i = 0; i < 5; i += 1) this.view.list.move(-1);
        return this.render();
      case 'pagedown':
        for (let i = 0; i < 5; i += 1) this.view.list.move(1);
        return this.render();
      case 'r':
        this.refreshContext();
        if (this.view.refresh) this.view.refresh(this, { force: true });
        this.setStatus('reloaded');
        return this.render();
      case 'enter': {
        this.activate(this.view.list.current());
        return this.render();
      }
      default:
        return undefined;
    }
  }

  quit() {
    this.running = false;
    this.screen.stop();
    if (this.options.closesPane && this.paneId && this.hasNeighbour()) {
      h.detachedHerdr(['pane', 'close', this.paneId]);
    }
    process.exit(0);
  }

  hasNeighbour() {
    try {
      const panes = h.paneList();
      const self = panes.find((p) => p.pane_id === this.paneId);
      return (
        Boolean(self) && panes.some((p) => p.tab_id === self.tab_id && p.pane_id !== this.paneId)
      );
    } catch (_) {
      return false;
    }
  }

  stamp() {
    const token = this.options.stamp;
    if (!this.paneId || !token) return;
    h.stampToken(this.paneId, OWNER_TOKEN, token.name, token.value, TOKEN_TTL_MS);
  }

  start() {
    this.stamp();
    setInterval(() => this.stamp(), STAMP_INTERVAL_MS).unref();
    this.refreshContext();
    this.screen.start();
    this.screen.onResize(() => this.render());
    if (!this.view && this.options.view) {
      this.setView(this.options.view());
    } else if (this.view) {
      if (this.view.refresh) this.view.refresh(this);
      this.render();
    }

    this._liveTimer = setInterval(() => {
      if (!this.running || this.pending) return;
      const prevCwd = this.ctx ? this.ctx.cwd : null;
      this.refreshContext();
      const cwdChanged = Boolean(this.ctx && this.ctx.cwd !== prevCwd);
      if (cwdChanged) {
        if (this.view && this.view.refresh) {
          this.view.refresh(this, { force: true });
        }
        this.render();
      }
    }, 1000);
    this._liveTimer.unref();

    process.stdin.on('data', (chunk) => {

      for (const event of parseKeys(chunk)) {
        try {
          this.handleKey(event);
        } catch (err) {
          this.setStatus(err.message.split('\n')[0], 'error');
          this.render();
        }
      }
    });
    process.on('exit', () => this.screen.stop());
  }
}

function selfPaneId(argv = process.argv) {
  const flag = argv.indexOf('--pane');
  return (flag !== -1 && argv[flag + 1]) || process.env.HERDR_PANE_ID || null;
}

function requireTTY(entry) {
  if (process.stdin.isTTY) return;
  process.stderr.write(
    `${entry} needs a TTY — open it from the launcher, or with herdr's pane commands.\n`
  );
  process.exit(1);
}

module.exports = { App, selfPaneId, requireTTY, STAMP_INTERVAL_MS };
