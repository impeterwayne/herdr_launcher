'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { readConfig, configDir, resolveContext } = require('./context');

const CONFIG_FILE = 'plane.json';

const DEFAULT_PLANE_CONFIG = {
  baseUrl: 'https://plane.itgproduct.com',
  workspaceSlug: 'product',
  apiKey: 'plane_api_68b11fbeb14c431cad3a1f87455b622a',
  projectId: '',
};

function readCodingSpaceSettings() {
  const appData = process.env.APPDATA || (process.env.HOME ? path.join(process.env.HOME, 'AppData', 'Roaming') : null);
  if (!appData) return null;
  for (const candidate of [
    path.join(appData, 'CodingSpace', 'workspaces.json'),
    path.join(appData, 'codingspace', 'workspaces.json'),
  ]) {
    try {
      if (fs.existsSync(candidate)) {
        const raw = JSON.parse(fs.readFileSync(candidate, 'utf8'));
        return raw && raw.settings ? raw.settings : null;
      }
    } catch (_) {}
  }
  return null;
}

function resolveProjectId(projectPlaneIds, targetPath) {
  if (!projectPlaneIds || typeof projectPlaneIds !== 'object') return null;
  if (!targetPath) return null;

  const targetNorm = path.resolve(targetPath).toLowerCase();
  const targetBase = path.basename(targetNorm);

  for (const [key, id] of Object.entries(projectPlaneIds)) {
    if (!id || typeof id !== 'string') continue;
    const cleanKey = key.trim();
    if (!cleanKey) continue;
    if (path.resolve(cleanKey).toLowerCase() === targetNorm) {
      return id.trim();
    }
  }

  for (const [key, id] of Object.entries(projectPlaneIds)) {
    if (!id || typeof id !== 'string') continue;
    const cleanKey = key.trim();
    if (!cleanKey) continue;
    const keyBase = path.basename(cleanKey).toLowerCase();
    if (keyBase && keyBase === targetBase) {
      return id.trim();
    }
  }

  return null;
}

function config(targetPath) {
  const raw = readConfig(CONFIG_FILE) || {};
  const cs = readCodingSpaceSettings() || {};

  let target = targetPath;
  if (!target) {
    try {
      const ctx = resolveContext();
      target = ctx ? ctx.cwd : process.cwd();
    } catch (_) {
      target = process.cwd();
    }
  }

  const projectPlaneIds = {
    ...(cs.projectPlaneIds || {}),
    ...(raw.projectPlaneIds || {}),
  };

  const resolvedProjectId =
    (typeof raw.projectId === 'string' && raw.projectId.trim()) ||
    resolveProjectId(projectPlaneIds, target) ||
    (typeof cs.planeProjectId === 'string' && cs.planeProjectId.trim()) ||
    (typeof process.env.HERDR_PLANE_PROJECT_ID === 'string' && process.env.HERDR_PLANE_PROJECT_ID.trim()) ||
    (typeof process.env.PLANE_PROJECT_ID === 'string' && process.env.PLANE_PROJECT_ID.trim()) ||
    DEFAULT_PLANE_CONFIG.projectId;

  return {
    baseUrl:
      (typeof raw.baseUrl === 'string' && raw.baseUrl.trim()) ||
      (typeof cs.planeBaseUrl === 'string' && cs.planeBaseUrl.trim()) ||
      DEFAULT_PLANE_CONFIG.baseUrl,
    workspaceSlug:
      (typeof raw.workspaceSlug === 'string' && raw.workspaceSlug.trim()) ||
      (typeof cs.planeWorkspaceSlug === 'string' && cs.planeWorkspaceSlug.trim()) ||
      DEFAULT_PLANE_CONFIG.workspaceSlug,
    apiKey:
      (typeof raw.apiKey === 'string' && raw.apiKey.trim()) ||
      (typeof cs.planeApiKey === 'string' && cs.planeApiKey.trim()) ||
      DEFAULT_PLANE_CONFIG.apiKey,
    projectId: resolvedProjectId,
    projectPlaneIds,
  };
}

const configPath = () => path.join(configDir(), CONFIG_FILE);

const isConfigured = (cfg = config()) =>
  Boolean(cfg && cfg.baseUrl && cfg.workspaceSlug && cfg.projectId && cfg.apiKey);

const base = (cfg) =>
  `${cfg.baseUrl.replace(/\/+$/, '')}/api/v1/workspaces/${cfg.workspaceSlug}/projects/${cfg.projectId}`;

async function get(cfg, suffix) {
  const response = await fetch(`${base(cfg)}${suffix}`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json', 'X-API-Key': cfg.apiKey },
  });
  if (!response.ok) {
    throw new Error(`Plane API ${response.status} ${response.statusText} on ${suffix}`);
  }
  return response.json();
}

const unwrap = (payload) => (Array.isArray(payload) ? payload : payload.results || []);

async function projects(cfg = config()) {
  const root = `${cfg.baseUrl.replace(/\/+$/, '')}/api/v1/workspaces/${cfg.workspaceSlug}/projects/`;
  const response = await fetch(root, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json', 'X-API-Key': cfg.apiKey },
  });
  if (!response.ok) {
    throw new Error(`Plane API ${response.status} ${response.statusText} on projects`);
  }
  return unwrap(await response.json());
}

async function issues(cfg = config()) {
  if (!isConfigured(cfg)) throw new Error(`Plane is not configured yet — see ${configPath()}`);

  const [statePayload, issuePayload] = await Promise.all([get(cfg, '/states/'), get(cfg, '/issues/')]);
  const states = new Map(unwrap(statePayload).map((s) => [s.id, s]));

  return unwrap(issuePayload)
    .map((issue) => {
      const state = states.get(issue.state);
      return {
        id: issue.id,
        sequence: issue.sequence_id,
        name: issue.name,
        priority: issue.priority,
        stateName: state ? state.name : 'unknown',
        stateGroup: state ? state.group : 'unknown',
        identifier:
          (issue.project_detail && issue.project_detail.identifier) || issue.project_identifier || '',
        updatedAt: issue.updated_at,
      };
    })
    .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
}

function webUrl(issue, cfg = config()) {
  if (!isConfigured(cfg)) return null;
  const root = `${cfg.baseUrl.replace(/\/+$/, '')}/${cfg.workspaceSlug}/projects/${cfg.projectId}`;
  return issue ? `${root}/issues/${issue.id}` : `${root}/issues/`;
}

module.exports = {
  CONFIG_FILE,
  DEFAULT_PLANE_CONFIG,
  config,
  configPath,
  isConfigured,
  issues,
  projects,
  webUrl,
  resolveProjectId,
  readCodingSpaceSettings,
};
