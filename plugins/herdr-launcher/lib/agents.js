'use strict';
 
const h = require('./herdr');
const { OWNER_TOKEN, isOurs, toolOf } = require('./context');

const AGENTS = [
  {
    key: 'opencode-auto',
    iconKey: 'agent-opencode',
    label: 'opencode',
    kind: 'opencode',
    args: ['--auto'],
    danger: true,
    title: 'OpenCode with --auto: auto-approves everything not explicitly denied.',
  },
  {
    key: 'agy-yolo',
    iconKey: 'agent-agy',
    label: 'antigravity',
    kind: 'agy',
    args: ['--dangerously-skip-permissions'],
    danger: true,
    title: 'Antigravity CLI with --dangerously-skip-permissions.',
  },
  {
    key: 'codex-yolo',
    iconKey: 'agent-codex',
    label: 'codex',
    kind: 'codex',
    args: ['--dangerously-bypass-approvals-and-sandbox'],
    danger: true,
    title: 'Codex without approvals or sandboxing. Isolated environments only.',
  },
  {
    key: 'claude-danger',
    iconKey: 'agent-claude',
    label: 'claude',
    kind: 'claude',
    args: ['--dangerously-skip-permissions'],
    danger: true,
    title: 'Claude Code with --dangerously-skip-permissions.',
  },
];

const byKey = (key) => AGENTS.find((a) => a.key === key) || null;

function isAgentPane(pane, agentList = []) {
  if (!pane) return false;
  if (pane.tokens) {
    if (pane.tokens[`${OWNER_TOKEN}-agent`] || pane.tokens.agent) return true;
    for (const [k, v] of Object.entries(pane.tokens)) {
      if (k.includes('agent') || String(v).includes('agent')) return true;
    }
  }
  if (Array.isArray(agentList) && agentList.some((a) => a.pane_id === pane.pane_id || a.name === pane.label)) {
    return true;
  }
  const label = String(pane.label || '').toLowerCase();
  if (AGENTS.some((a) => label.startsWith(a.label.toLowerCase()) || label.startsWith(a.kind.toLowerCase()))) {
    return true;
  }
  return false;
}

function enrichWithLayout(panes) {
  if (!panes || !panes.length) return panes;
  const anchor = panes.find((p) => p.pane_id) || panes[0];
  if (!anchor || !anchor.pane_id) return panes;
  try {
    const layout = h.paneLayout(anchor.pane_id);
    if (layout && Array.isArray(layout.panes)) {
      const rectMap = new Map(layout.panes.map((p) => [p.pane_id, p.rect]));
      return panes.map((p) => {
        const rect = rectMap.get(p.pane_id) || p.rect || null;
        return rect ? { ...p, rect } : p;
      });
    }
  } catch (_) {}
  return panes;
}

function sortLeftToRight(panes) {
  return [...panes].sort((a, b) => {
    const ax = a.rect ? a.rect.x : 0;
    const bx = b.rect ? b.rect.x : 0;
    if (ax !== bx) return ax - bx;
    const ay = a.rect ? a.rect.y : 0;
    const by = b.rect ? b.rect.y : 0;
    if (ay !== by) return ay - by;
    return String(a.pane_id || '').localeCompare(String(b.pane_id || ''));
  });
}

function resolveFibonacciTarget({ ctx, tabPanes = [], agentList = [], explicitDirection = null, customRatio = null }) {
  const isSidebar = (p) => isOurs(p) && !isAgentPane(p, agentList);
  const isTool = (p) => Boolean(toolOf(p));
  const enriched = enrichWithLayout(tabPanes);
  const nonPluginPanes = sortLeftToRight(enriched.filter((p) => !isSidebar(p) && !isTool(p)));

  // The leftmost non-plugin pane is the permanent master work pane
  const masterPane = nonPluginPanes.length > 0 ? nonPluginPanes[0] : null;
  const agentPanes = nonPluginPanes.filter((p) => (!masterPane || p.pane_id !== masterPane.pane_id) && isAgentPane(p, agentList));

  // Sort agent panes by spiral order (pane_id)
  agentPanes.sort((a, b) => {
    const numA = parseInt(String(a.pane_id || '').replace(/\D/g, ''), 10) || 0;
    const numB = parseInt(String(b.pane_id || '').replace(/\D/g, ''), 10) || 0;
    if (numA !== numB) return numA - numB;
    return String(a.pane_id || '').localeCompare(String(b.pane_id || ''));
  });

  let targetPane = null;

  // Fibonacci spiral / dwindle:
  // - If agent panes already exist on the right, ALWAYS split into the agent stack
  //   so the master work pane on the left is permanently preserved at full height!
  // - If no agent panes exist yet, split the master work pane to the right.
  if (agentPanes.length > 0) {
    if (ctx && ctx.pane && isAgentPane(ctx.pane, agentList) && masterPane && ctx.pane.pane_id !== masterPane.pane_id && agentPanes.some((p) => p.pane_id === ctx.pane.pane_id)) {
      targetPane = agentPanes.find((p) => p.pane_id === ctx.pane.pane_id) || agentPanes[agentPanes.length - 1];
    } else {
      targetPane = agentPanes[agentPanes.length - 1];
    }
  } else if (masterPane) {
    targetPane = masterPane;
  } else if (nonPluginPanes.length > 0) {
    targetPane = nonPluginPanes[0];
  } else if (enriched.length > 0) {
    targetPane = enriched[0];
  }

  if (!targetPane) {
    throw new Error('no active pane to split — open a pane first');
  }

  let direction = explicitDirection;
  if (!direction) {
    let rect = targetPane.rect;
    if (!rect) {
      try {
        const layout = h.paneLayout(targetPane.pane_id);
        const found = layout && layout.panes && layout.panes.find((p) => p.pane_id === targetPane.pane_id);
        if (found) rect = found.rect;
      } catch (_) {}
    }

    if (rect && rect.width && rect.height) {
      direction = rect.width > rect.height * 2 ? 'right' : 'down';
    } else {
      direction = agentPanes.length % 2 === 0 ? 'right' : 'down';
    }
  }

  const ratio = customRatio !== null && customRatio !== undefined ? customRatio : 0.5;

  return {
    targetPane,
    direction,
    ratio,
    agentPanes,
    workPanes: nonPluginPanes,
  };
}

module.exports = { AGENTS, byKey, isAgentPane, resolveFibonacciTarget };

