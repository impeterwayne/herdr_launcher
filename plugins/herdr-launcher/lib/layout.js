'use strict';

const h = require('./herdr');

const rectEq = (a, b) =>
  Boolean(a && b) && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;

const inside = (outer, inner) =>
  inner.x >= outer.x &&
  inner.y >= outer.y &&
  inner.x + inner.width <= outer.x + outer.width &&
  inner.y + inner.height <= outer.y + outer.height;

function halves(rect, direction, boundary) {
  if (direction === 'right') {
    return [
      { x: rect.x, y: rect.y, width: boundary - rect.x, height: rect.height },
      { x: boundary, y: rect.y, width: rect.x + rect.width - boundary, height: rect.height },
    ];
  }
  return [
    { x: rect.x, y: rect.y, width: rect.width, height: boundary - rect.y },
    { x: rect.x, y: boundary, width: rect.width, height: rect.y + rect.height - boundary },
  ];
}

function candidates(rect, direction, splits, panes, ratio) {
  const horizontal = direction === 'right';
  const origin = horizontal ? rect.x : rect.y;
  const extent = horizontal ? rect.width : rect.height;
  const guess = origin + Math.max(1, Math.min(extent - 1, Math.round(extent * ratio)));

  const edges = new Set([guess]);
  for (const item of [...splits.map((s) => s.rect), ...panes.map((p) => p.rect)]) {
    if (!inside(rect, item)) continue;
    const edge = horizontal ? item.x : item.y;
    if (edge > origin && edge < origin + extent) edges.add(edge);
  }
  return [...edges].sort((a, b) => Math.abs(a - guess) - Math.abs(b - guess));
}

function record(layout) {
  if (!layout || !layout.area) return null;
  const panes = layout.panes || [];

  const build = (rect, splits, depth) => {
    if (depth > 64) return null;
    const index = splits.findIndex((s) => rectEq(s.rect, rect));
    if (index !== -1) {
      const split = splits[index];
      const rest = [...splits.slice(0, index), ...splits.slice(index + 1)];
      for (const boundary of candidates(rect, split.direction, rest, panes, split.ratio)) {
        const [firstRect, secondRect] = halves(rect, split.direction, boundary);
        const first = build(firstRect, rest, depth + 1);
        if (!first) continue;
        const second = build(secondRect, first.splits, depth + 1);
        if (!second) continue;
        return {
          node: {
            direction: split.direction,
            ratio: split.ratio,
            first: first.node,
            second: second.node,
          },
          splits: second.splits,
        };
      }
      return null;
    }
    const pane = panes.find((p) => rectEq(p.rect, rect));
    return pane ? { node: { pane: pane.pane_id }, splits } : null;
  };

  const built = build(layout.area, layout.splits || [], 0);
  return built ? built.node : null;
}

function leaves(node) {
  if (!node) return [];
  if (node.pane) return [node.pane];
  return [...leaves(node.first), ...leaves(node.second)];
}

function rootSplitOf(tree) {
  return tree && !tree.pane ? tree : null;
}

function replay(node, anchor, { tabId, alive, dryRun = false } = {}) {
  const ops = [];
  const isAlive = (id) => !alive || alive.has(id);

  const walk = (current, held) => {
    if (!current || current.pane) return;
    const firstSide = leaves(current.first).filter(isAlive);
    const secondSide = leaves(current.second).filter(isAlive);
    if (!firstSide.length) return walk(current.second, held);
    if (!secondSide.length) return walk(current.first, held);

    const anchorInFirst = firstSide.includes(held);
    if (!anchorInFirst && !secondSide.includes(held)) {

      throw new Error(`replay lost its anchor: ${held} is not in this region`);
    }
    const bring = anchorInFirst ? secondSide[0] : firstSide[0];
    const split = current.direction === 'right' ? 'right' : 'down';

    ops.push({ op: 'move', pane: bring, target: held, split, ratio: current.ratio });
    if (!dryRun) {
      h.paneMove(bring, { tab: tabId, targetPane: held, split, ratio: current.ratio });
    }
    if (!anchorInFirst) {
      ops.push({ op: 'swap', panes: [held, bring] });
      if (!dryRun) h.paneSwap(held, bring);
    }

    walk(current.first, anchorInFirst ? held : bring);
    walk(current.second, anchorInFirst ? bring : held);
  };

  walk(node, anchor);
  return ops;
}

module.exports = { rectEq, inside, halves, candidates, record, leaves, rootSplitOf, replay };
