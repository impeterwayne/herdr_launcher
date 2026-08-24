'use strict';

const net = require('node:net');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const BIN = process.env.HERDR_BIN_PATH || 'herdr';
const BS = String.fromCharCode(92);

function socketPath() {
  if (process.env.HERDR_SOCKET_PATH) return process.env.HERDR_SOCKET_PATH;
  const res = spawnSync(BIN, ['status', 'server'], { encoding: 'utf8', windowsHide: true });
  const match = (res.stdout || '').match(/^socket:\s*(.+)$/m);
  if (match) return match[1].trim();
  const home = process.env.APPDATA || process.env.HOME || '.';
  return path.join(home, 'herdr', 'herdr.sock');
}

function endpoint() {
  const socket = socketPath();
  if (process.platform !== 'win32') return socket;
  return `${BS}${BS}.${BS}pipe${BS}${socket}`;
}

function connect({ onLine, onOpen, onClose, onError }) {
  const sock = net.connect({ path: endpoint() });
  let buffer = '';

  sock.on('connect', () => onOpen && onOpen(sock));
  sock.on('data', (chunk) => {
    buffer += chunk.toString('utf8');
    let index;
    while ((index = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (!line) continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch (_) {
        continue;
      }
      onLine(message);
    }
  });
  sock.on('error', (err) => onError && onError(err));
  sock.on('close', () => onClose && onClose());
  return sock;
}

function request(method, params = {}, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const done = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        sock.end();
      } catch (_) {

      }
      fn(value);
    };
    const sock = connect({
      onOpen: () => sock.write(`${JSON.stringify({ id: `plugin:${method}`, method, params })}\n`),
      onLine: (message) => {
        if (message.error) done(reject, new Error(JSON.stringify(message.error)));
        else done(resolve, message.result || {});
      },
      onError: (err) => done(reject, err),
      onClose: () => done(reject, new Error(`${method}: connection closed`)),
    });
    const timer = setTimeout(() => done(reject, new Error(`${method}: timed out`)), timeoutMs);
  });
}

function subscribe(types, onEvent, { onClose, onError, onReady } = {}) {
  const sock = connect({
    onOpen: () => {
      const params = { subscriptions: types.map((type) => ({ type })) };
      sock.write(`${JSON.stringify({ id: 'plugin:subscribe', method: 'events.subscribe', params })}\n`);
    },
    onLine: (message) => {
      if (message.result && message.result.type === 'subscription_started') {
        if (onReady) onReady();
        return;
      }
      if (
        message.event ||
        message.method === 'events.event' ||
        message.method === 'events.notification' ||
        message.type ||
        message.data
      ) {
        onEvent(message);
      }
    },
    onClose,
    onError,
  });
  return sock;
}

module.exports = { socketPath, endpoint, connect, request, subscribe };
