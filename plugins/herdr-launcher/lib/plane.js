'use strict';

const { readConfig, configDir } = require('./context');
const path = require('node:path');

const CONFIG_FILE = 'plane.json';

const config = () => readConfig(CONFIG_FILE);
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

async function issues() {
  const cfg = config();
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

function webUrl(issue) {
  const cfg = config();
  if (!isConfigured(cfg)) return null;
  const root = `${cfg.baseUrl.replace(/\/+$/, '')}/${cfg.workspaceSlug}/projects/${cfg.projectId}`;
  return issue ? `${root}/issues/${issue.id}` : `${root}/issues/`;
}

module.exports = { CONFIG_FILE, config, configPath, isConfigured, issues, webUrl };
