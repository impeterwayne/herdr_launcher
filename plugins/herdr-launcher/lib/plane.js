'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  readConfig,
  writeConfig,
  configDir,
  resolveContext,
  findRepoRoot,
  findParentRepoRoot,
} = require('./context');

const CONFIG_FILE = 'plane.json';

const DEFAULT_PLANE_CONFIG = {
  baseUrl: 'https://plane.itgproduct.com',
  workspaceSlug: 'product',
  apiKey: '',
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

function readLocalPlaneConfig(targetPath) {
  if (!targetPath) return null;
  const parentRoot = findParentRepoRoot(targetPath);
  const worktreeRoot = findRepoRoot(targetPath);
  const candidates = [];
  if (parentRoot) {
    candidates.push(path.join(parentRoot, '.plane.json'));
    candidates.push(path.join(parentRoot, '.herdr', 'plane.json'));
    candidates.push(path.join(parentRoot, 'plane.json'));
  }
  if (worktreeRoot && worktreeRoot !== parentRoot) {
    candidates.push(path.join(worktreeRoot, '.plane.json'));
    candidates.push(path.join(worktreeRoot, '.herdr', 'plane.json'));
    candidates.push(path.join(worktreeRoot, 'plane.json'));
  }
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) {
        const raw = JSON.parse(fs.readFileSync(candidate, 'utf8'));
        if (raw && typeof raw === 'object') return raw;
      }
    } catch (_) {}
  }
  return null;
}

function normalizePathKey(p) {
  if (!p || typeof p !== 'string') return '';
  return p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

function getPathBasename(p) {
  const n = normalizePathKey(p);
  const idx = n.lastIndexOf('/');
  return idx >= 0 ? n.slice(idx + 1) : n;
}

function resolveProjectId(projectPlaneIds, targetPath) {
  if (!projectPlaneIds || typeof projectPlaneIds !== 'object') return null;
  if (!targetPath) return null;

  const targetNorm = normalizePathKey(targetPath);
  const worktreeRoot = findRepoRoot(targetPath);
  const worktreeNorm = worktreeRoot ? normalizePathKey(worktreeRoot) : null;
  const parentRoot = findParentRepoRoot(targetPath);
  const parentNorm = parentRoot ? normalizePathKey(parentRoot) : null;

  const candidatePaths = [targetNorm];
  if (worktreeNorm && !candidatePaths.includes(worktreeNorm)) candidatePaths.push(worktreeNorm);
  if (parentNorm && !candidatePaths.includes(parentNorm)) candidatePaths.push(parentNorm);

  // 1. Exact path match (target path, worktree root, or parent repo/workspace root)
  for (const [key, id] of Object.entries(projectPlaneIds)) {
    if (!id || typeof id !== 'string') continue;
    const cleanKey = key.trim();
    if (!cleanKey) continue;
    const keyNorm = normalizePathKey(cleanKey);
    if (candidatePaths.includes(keyNorm)) {
      return id.trim();
    }
  }

  // 2. Ancestor directory match (key is an ancestor/parent directory of target, worktree, or parent root)
  for (const [key, id] of Object.entries(projectPlaneIds)) {
    if (!id || typeof id !== 'string') continue;
    const cleanKey = key.trim();
    if (!cleanKey) continue;
    const keyNorm = normalizePathKey(cleanKey);
    for (const cand of candidatePaths) {
      if (cand.startsWith(keyNorm + '/')) {
        return id.trim();
      }
    }
  }

  // 3. Basename match (parent workspace base, worktree base, or target base)
  const candidateBases = [];
  if (parentNorm) candidateBases.push(getPathBasename(parentNorm));
  if (worktreeNorm && !candidateBases.includes(getPathBasename(worktreeNorm))) {
    candidateBases.push(getPathBasename(worktreeNorm));
  }
  const targetBase = getPathBasename(targetNorm);
  if (!candidateBases.includes(targetBase)) candidateBases.push(targetBase);

  for (const [key, id] of Object.entries(projectPlaneIds)) {
    if (!id || typeof id !== 'string') continue;
    const cleanKey = key.trim();
    if (!cleanKey) continue;
    const keyBase = getPathBasename(cleanKey);
    if (candidateBases.includes(keyBase)) {
      return id.trim();
    }
  }

  return null;
}

function saveWorkspaceProjectId(targetPath, projectId) {
  const parentRoot =
    findParentRepoRoot(targetPath) ||
    findRepoRoot(targetPath) ||
    (targetPath ? path.resolve(targetPath) : process.cwd());
  const current = readConfig(CONFIG_FILE) || {};
  const projectPlaneIds = { ...(current.projectPlaneIds || {}) };
  projectPlaneIds[parentRoot] = projectId;
  const updated = { ...current, projectPlaneIds };
  delete updated.projectId;
  writeConfig(CONFIG_FILE, updated);
  return { ok: true, parentRoot, projectId };
}

function saveApiKey(apiKey) {
  if (!apiKey || typeof apiKey !== 'string' || !apiKey.trim()) {
    return { ok: false, error: 'Plane API key cannot be empty' };
  }
  const cleanKey = apiKey.trim();
  const current = readConfig(CONFIG_FILE) || {};
  const updated = { ...current, apiKey: cleanKey };
  writeConfig(CONFIG_FILE, updated);
  return { ok: true, apiKey: cleanKey };
}

function promptApiKey(initialValue = '') {
  if (process.platform === 'win32') {
    const initial = (initialValue || '').replace(/'/g, "''");
    const psScript = `
      Add-Type -AssemblyName Microsoft.VisualBasic
      Add-Type -AssemblyName System.Windows.Forms
      $top = New-Object System.Windows.Forms.Form
      $top.TopMost = $true
      $key = [Microsoft.VisualBasic.Interaction]::InputBox("Enter your Plane API Key (e.g. plane_api_...):", "Plane API Key", '${initial}')
      if ($key) {
        Write-Output $key
      }
      $top.Dispose()
    `;
    try {
      const { spawnSync } = require('node:child_process');
      const res = spawnSync('powershell.exe', ['-NoProfile', '-STA', '-Command', psScript], {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 120000,
      });
      const key = (res.stdout || '').trim().split(/\r?\n/).filter(Boolean).pop();
      return key ? key.trim() : null;
    } catch (_) {
      return null;
    }
  }
  if (process.platform === 'darwin') {
    try {
      const { spawnSync } = require('node:child_process');
      const escaped = (initialValue || '').replace(/"/g, '\\"');
      const res = spawnSync(
        'osascript',
        ['-e', `text returned of (display dialog "Enter your Plane API Key:" default answer "${escaped}" with title "Plane API Key")`],
        {
          encoding: 'utf8',
          timeout: 120000,
        }
      );
      const key = (res.stdout || '').trim();
      return key ? key.trim() : null;
    } catch (_) {
      return null;
    }
  }
  try {
    const { spawnSync } = require('node:child_process');
    const res = spawnSync(
      'zenity',
      ['--entry', '--title=Plane API Key', '--text=Enter your Plane API Key:', `--entry-text=${initialValue || ''}`],
      {
        encoding: 'utf8',
        timeout: 120000,
      }
    );
    const key = (res.stdout || '').trim();
    if (key) return key.trim();
  } catch (_) {}
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

  const local = readLocalPlaneConfig(target) || {};

  const projectPlaneIds = {
    ...(cs.projectPlaneIds || {}),
    ...(raw.projectPlaneIds || {}),
  };

  const resolvedProjectId =
    (typeof local.projectId === 'string' && local.projectId.trim()) ||
    resolveProjectId(projectPlaneIds, target) ||
    (typeof process.env.HERDR_PLANE_PROJECT_ID === 'string' && process.env.HERDR_PLANE_PROJECT_ID.trim()) ||
    (typeof process.env.PLANE_PROJECT_ID === 'string' && process.env.PLANE_PROJECT_ID.trim()) ||
    DEFAULT_PLANE_CONFIG.projectId;

  return {
    baseUrl:
      (typeof local.baseUrl === 'string' && local.baseUrl.trim()) ||
      (typeof raw.baseUrl === 'string' && raw.baseUrl.trim()) ||
      (typeof cs.planeBaseUrl === 'string' && cs.planeBaseUrl.trim()) ||
      DEFAULT_PLANE_CONFIG.baseUrl,
    workspaceSlug:
      (typeof local.workspaceSlug === 'string' && local.workspaceSlug.trim()) ||
      (typeof raw.workspaceSlug === 'string' && raw.workspaceSlug.trim()) ||
      (typeof cs.planeWorkspaceSlug === 'string' && cs.planeWorkspaceSlug.trim()) ||
      DEFAULT_PLANE_CONFIG.workspaceSlug,
    apiKey:
      (typeof process.env.HERDR_PLANE_API_KEY === 'string' && process.env.HERDR_PLANE_API_KEY.trim()) ||
      (typeof process.env.PLANE_API_KEY === 'string' && process.env.PLANE_API_KEY.trim()) ||
      (typeof local.apiKey === 'string' && local.apiKey.trim()) ||
      (typeof raw.apiKey === 'string' && raw.apiKey.trim()) ||
      (typeof cs.planeApiKey === 'string' && cs.planeApiKey.trim()) ||
      DEFAULT_PLANE_CONFIG.apiKey,
    projectId: resolvedProjectId,
    projectPlaneIds,
    parentRoot: findParentRepoRoot(target),
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
      };
    })
    .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
}

function webUrl(issue, cfg = config()) {
  if (!isConfigured(cfg)) return null;
  const root = `${cfg.baseUrl.replace(/\/+$/, '')}/${cfg.workspaceSlug}/projects/${cfg.projectId}`;
  return issue ? `${root}/issues/${issue.id}` : `${root}/issues/`;
}

const USER_AGENT_HEADER =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

async function fetchProjectDetails(cfg = config()) {
  try {
    const url = `${cfg.baseUrl.replace(/\/+$/, '')}/api/v1/workspaces/${cfg.workspaceSlug}/projects/${cfg.projectId}/`;
    const response = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json', 'X-API-Key': cfg.apiKey },
    });
    if (!response.ok) return null;
    return response.json();
  } catch (_) {
    return null;
  }
}

function cleanHTML(html) {
  if (!html) return '';
  const text = String(html).replace(/<[^>]*>/g, ' ');
  return text.replace(/\s+/g, ' ').trim();
}

function formatPriority(priority) {
  switch ((priority || '').toLowerCase()) {
    case 'urgent':
      return '🔥 Urgent';
    case 'high':
      return '🔴 High';
    case 'medium':
      return '🟡 Medium';
    case 'low':
      return '🔵 Low';
    default:
      return '⚪ None';
  }
}

function formatDate(dateStr) {
  if (!dateStr) return 'Unset';
  return String(dateStr);
}

async function scrapeLightshotImageURL(prntUrl) {
  try {
    const res = await fetch(prntUrl, {
      headers: { 'User-Agent': USER_AGENT_HEADER },
    });
    if (!res.ok) return null;
    const html = await res.text();
    const ogMatch = html.match(/<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/i);
    if (ogMatch && ogMatch[1]) return ogMatch[1];
    const imgMatch = html.match(/id=["']screenshot-image["']\s+src=["']([^"']+)["']/i);
    if (imgMatch && imgMatch[1]) return imgMatch[1];
  } catch (_) {}
  return null;
}

async function scrapeStreamableMediaURLs(mediaId, streamableUrl) {
  try {
    const apiRes = await fetch(`https://api.streamable.com/videos/${mediaId}`, {
      headers: { 'User-Agent': USER_AGENT_HEADER },
    });
    if (apiRes.ok) {
      const data = await apiRes.json();
      let videoUrl = null;
      let posterUrl = null;
      if (data.thumbnail_url) {
        posterUrl = data.thumbnail_url.startsWith('//') ? `https:${data.thumbnail_url}` : data.thumbnail_url;
      }
      if (data.files && data.files.mp4 && data.files.mp4.url) {
        const u = data.files.mp4.url;
        videoUrl = u.startsWith('//') ? `https:${u}` : u;
      }
      if (videoUrl) return { videoUrl, posterUrl };
    }
    const htmlRes = await fetch(streamableUrl, {
      headers: { 'User-Agent': USER_AGENT_HEADER },
    });
    if (htmlRes.ok) {
      const html = await htmlRes.text();
      let videoUrl = null;
      let posterUrl = null;
      const videoMatch = html.match(/<meta\s+property=["']og:video:secure_url["']\s+content=["']([^"']+)["']/i);
      if (videoMatch && videoMatch[1]) videoUrl = videoMatch[1];
      const imageMatch = html.match(/<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/i);
      if (imageMatch && imageMatch[1]) posterUrl = imageMatch[1];
      return { videoUrl, posterUrl };
    }
  } catch (_) {}
  return { videoUrl: null, posterUrl: null };
}

async function downloadFile(url, targetPath) {
  try {
    if (fs.existsSync(targetPath) && fs.statSync(targetPath).size > 0) {
      return { success: true, cached: true };
    }
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT_HEADER } });
    if (!res.ok) return { success: false, error: res.statusText };
    const arrayBuffer = await res.arrayBuffer();
    fs.writeFileSync(targetPath, Buffer.from(arrayBuffer));
    return { success: true, cached: false };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function categorizeIssues(issues, stateMap) {
  const backlog = [];
  const todo = [];
  const inProgress = [];
  const done = [];
  const cancelled = [];
  const other = [];

  for (const issue of issues) {
    const stateInfo = stateMap.get(issue.state);
    if (stateInfo) {
      issue.stateName = stateInfo.name;
      issue.stateGroup = stateInfo.group;
    } else {
      issue.stateName = issue.stateName || 'Unknown';
      issue.stateGroup = issue.stateGroup || 'other';
    }

    const group = (issue.stateGroup || '').toLowerCase();
    const name = (issue.stateName || '').toLowerCase();

    if (group === 'backlog' || name === 'backlog') {
      backlog.push(issue);
    } else if (group === 'unstarted' || name === 'todo') {
      todo.push(issue);
    } else if (group === 'started' || name === 'in progress') {
      inProgress.push(issue);
    } else if (group === 'completed' || name === 'done') {
      done.push(issue);
    } else if (group === 'cancelled' || name === 'cancelled') {
      cancelled.push(issue);
    } else {
      other.push(issue);
    }
  }

  return { backlog, todo, inProgress, done, cancelled, other };
}

function generateTaskListMD(cfg, issues, stateMap, mediaMap, projectInfo, selectedCategories = ['all']) {
  const { backlog, todo, inProgress, done, cancelled, other } = categorizeIssues(issues, stateMap);
  const totalCount = issues.length;
  const now = new Date().toISOString().replace('T', ' ').substring(0, 19);

  const projectName = (projectInfo && projectInfo.name) || (issues[0]?.project_detail?.name) || 'Plane Project';
  const projectIdentifier =
    (projectInfo && projectInfo.identifier) ||
    issues[0]?.project_detail?.identifier ||
    issues[0]?.project_identifier ||
    '';

  const includeAll = !selectedCategories || selectedCategories.includes('all');
  const inc = (cat) => includeAll || selectedCategories.includes(cat);

  let md = `# 📋 Plane Comprehensive Task List (All States)\n\n`;
  md += `> **Workspace:** \`${cfg.workspaceSlug}\` | **Project:** \`${projectName}\` (\`${cfg.projectId}\`)  \n`;
  md += `> **Generated:** ${now}  \n`;
  md += `> **Total Tasks Included:** **${totalCount}**  \n\n`;

  md += `---\n\n`;
  md += `## 📊 Summary Overview\n\n`;
  md += `| State Category | Task Count | Status Emoji |\n`;
  md += `| :--- | :---: | :---: |\n`;
  if (inc('backlog')) md += `| 🔴 **Backlog** | ${backlog.length} | 🔴 |\n`;
  if (inc('todo')) md += `| 🟡 **Todo** | ${todo.length} | 🟡 |\n`;
  if (inc('in_progress')) md += `| 🔵 **In Progress** | ${inProgress.length} | 🔵 |\n`;
  if (inc('done')) md += `| 🟢 **Done** | ${done.length} | 🟢 |\n`;
  if (inc('cancelled')) md += `| ⚪ **Cancelled** | ${cancelled.length} | ⚪ |\n`;
  if (other.length > 0 && inc('other')) {
    md += `| ❓ **Other/Draft** | ${other.length} | ❓ |\n`;
  }
  md += `| **TOTAL** | **${totalCount}** | ✨ |\n\n`;

  const formatItem = (checkbox, item) => {
    const seq = item.sequence_id || item.sequence;
    const itemPrefix = projectIdentifier || item.project_detail?.identifier || item.project_identifier || '';
    const taskTag = itemPrefix ? `${itemPrefix}-${seq}` : `#${seq}`;
    let itemMd = `- [${checkbox}] **${taskTag}**: ${item.name}\n`;
    itemMd += `  - **Priority:** ${formatPriority(item.priority)} | **Start Date:** \`${formatDate(item.start_date)}\``;
    if (item.updated_at || item.updatedAt) {
      itemMd += ` | **Last Updated:** \`${formatDate(item.updated_at || item.updatedAt)}\``;
    }
    itemMd += `\n`;
    const desc = cleanHTML(item.description_html);
    if (desc) itemMd += `  - **Details/Evidence:** ${desc}\n`;

    const mediaList = mediaMap && mediaMap.get(seq);
    if (mediaList && mediaList.length > 0) {
      itemMd += `  - **Downloaded Offline Evidence:**\n`;
      for (const m of mediaList) {
        if (m.type === 'image') {
          itemMd += `    - Screenshot: [${m.mediaId}](${m.webUrl}) → ![Preview](${m.localPath})\n`;
        } else if (m.type === 'video') {
          itemMd += `    - Video Recording: [${m.mediaId}](${m.webUrl}) → [Full MP4 Video](${m.localPath})\n`;
          itemMd += `      <video controls src="${m.localPath}" poster="${m.posterPath || ''}" width="480"></video>\n`;
        }
      }
    }
    itemMd += `\n`;
    return itemMd;
  };

  if (inc('backlog') && backlog.length > 0) {
    md += `---\n\n## 🔴 1. Backlog Tasks (${backlog.length})\n\n`;
    for (const item of backlog) md += formatItem(' ', item);
  }

  if (inc('todo') && todo.length > 0) {
    md += `---\n\n## 🟡 2. Todo Tasks (${todo.length})\n\n`;
    for (const item of todo) md += formatItem(' ', item);
  }

  if (inc('in_progress') && inProgress.length > 0) {
    md += `---\n\n## 🔵 3. In Progress Tasks (${inProgress.length})\n\n`;
    for (const item of inProgress) md += formatItem('/', item);
  }

  if (inc('done') && done.length > 0) {
    md += `---\n\n## 🟢 4. Done Tasks (${done.length})\n\n`;
    for (const item of done) md += formatItem('x', item);
  }

  if (inc('cancelled') && cancelled.length > 0) {
    md += `---\n\n## ⚪ 5. Cancelled Tasks (${cancelled.length})\n\n`;
    for (const item of cancelled) md += formatItem(' ', item);
  }

  if (inc('other') && other.length > 0) {
    md += `---\n\n## ❓ 6. Other / Draft Tasks (${other.length})\n\n`;
    for (const item of other) md += formatItem(' ', item);
  }

  md += `---\n*Comprehensive task list generated automatically via Plane REST API client.*`;
  return md;
}

async function syncProject(worktreePath, cfg = config(worktreePath), options = {}, onProgress = () => {}) {
  let opts = options;
  let progressCb = onProgress;
  if (typeof options === 'function') {
    progressCb = options;
    opts = {};
  }
  const selectedCategories = (opts && opts.categories) || ['all'];

  if (!isConfigured(cfg)) {
    throw new Error(`Plane is not configured for ${worktreePath}`);
  }

  const targetDir = worktreePath || process.cwd();
  const planeDir = path.join(targetDir, 'plane');
  const rawDir = path.join(planeDir, 'raw');
  const evidenceDir = path.join(planeDir, 'evidence');

  fs.mkdirSync(rawDir, { recursive: true });
  fs.mkdirSync(evidenceDir, { recursive: true });

  // Exclude plane/ directory in .git/info/exclude
  try {
    const gitx = require('./gitx');
    gitx.addExcludes(targetDir, ['plane/', 'plane/*']);
  } catch (_) {}

  progressCb('Fetching tasks and states from Plane API…');
  const [statePayload, issuePayload, projectInfo] = await Promise.all([
    get(cfg, '/states/'),
    get(cfg, '/issues/'),
    fetchProjectDetails(cfg),
  ]);

  const states = unwrap(statePayload);
  const rawIssues = unwrap(issuePayload);
  const stateMap = new Map(states.map((s) => [s.id, s]));

  // Filter issues according to selected categories
  const categorized = categorizeIssues(rawIssues, stateMap);
  const includeAll = selectedCategories.includes('all');
  const issuesList = [];
  if (includeAll || selectedCategories.includes('backlog')) issuesList.push(...categorized.backlog);
  if (includeAll || selectedCategories.includes('todo')) issuesList.push(...categorized.todo);
  if (includeAll || selectedCategories.includes('in_progress')) issuesList.push(...categorized.inProgress);
  if (includeAll || selectedCategories.includes('done')) issuesList.push(...categorized.done);
  if (includeAll || selectedCategories.includes('cancelled')) issuesList.push(...categorized.cancelled);
  if (includeAll || selectedCategories.includes('other')) issuesList.push(...categorized.other);

  // Write raw json metadata
  fs.writeFileSync(path.join(rawDir, 'issues.json'), JSON.stringify(rawIssues, null, 2), 'utf8');
  fs.writeFileSync(path.join(rawDir, 'states.json'), JSON.stringify(states, null, 2), 'utf8');

  // Download evidence
  progressCb(`Scanning and downloading evidence media for ${issuesList.length} tasks…`);
  const mediaMap = new Map();
  const defaultProjIdentifier = (projectInfo && projectInfo.identifier) || '';

  for (let i = 0; i < issuesList.length; i++) {
    const task = issuesList[i];
    const seq = task.sequence_id || task.sequence;
    const desc = task.description_html || '';
    const projPrefix =
      (task.project_detail && task.project_detail.identifier) ||
      task.project_identifier ||
      defaultProjIdentifier;
    const taskID = projPrefix ? `${projPrefix}-${seq}` : `TASK-${seq}`;
    const taskMediaList = [];

    // Screenshots from prnt.sc
    const prntMatches = desc.match(/https?:\/\/prnt\.sc\/([a-zA-Z0-9_-]+)/g);
    if (prntMatches) {
      for (const webUrl of prntMatches) {
        const mediaId = webUrl.split('/').pop();
        if (!mediaId || taskMediaList.some((m) => m.mediaId === mediaId)) continue;
        const targetFilePath = path.join(evidenceDir, taskID, `${mediaId}.png`);
        const relLocalPath = `./evidence/${taskID}/${mediaId}.png`;
        const imgUrl = await scrapeLightshotImageURL(webUrl);
        if (imgUrl) {
          const dlRes = await downloadFile(imgUrl, targetFilePath);
          if (dlRes.success) {
            taskMediaList.push({
              type: 'image',
              webUrl,
              mediaId,
              localPath: relLocalPath,
            });
          }
        }
      }
    }

    // Videos from streamable
    const streamableMatches = desc.match(/https?:\/\/streamable\.com\/([a-zA-Z0-9_-]+)/g);
    if (streamableMatches) {
      for (const webUrl of streamableMatches) {
        const mediaId = webUrl.split('/').pop();
        if (!mediaId || taskMediaList.some((m) => m.mediaId === mediaId)) continue;
        const targetVideoPath = path.join(evidenceDir, taskID, `${mediaId}.mp4`);
        const targetPosterPath = path.join(evidenceDir, taskID, `${mediaId}_poster.jpg`);
        const relVideoPath = `./evidence/${taskID}/${mediaId}.mp4`;
        const relPosterPath = `./evidence/${taskID}/${mediaId}_poster.jpg`;
        const { videoUrl, posterUrl } = await scrapeStreamableMediaURLs(mediaId, webUrl);
        if (posterUrl) {
          await downloadFile(posterUrl, targetPosterPath);
        }
        if (videoUrl) {
          const dlRes = await downloadFile(videoUrl, targetVideoPath);
          if (dlRes.success) {
            taskMediaList.push({
              type: 'video',
              webUrl,
              mediaId,
              localPath: relVideoPath,
              posterPath: relPosterPath,
            });
          }
        }
      }
    }

    if (taskMediaList.length > 0) {
      mediaMap.set(seq, taskMediaList);
    }
  }

  // Generate and write TASK_LIST.md
  progressCb('Writing plane/TASK_LIST.md…');
  const mdContent = generateTaskListMD(cfg, issuesList, stateMap, mediaMap, projectInfo, selectedCategories);
  fs.writeFileSync(path.join(planeDir, 'TASK_LIST.md'), mdContent, 'utf8');

  return {
    ok: true,
    taskCount: issuesList.length,
    evidenceCount: Array.from(mediaMap.values()).reduce((sum, list) => sum + list.length, 0),
    path: path.join(planeDir, 'TASK_LIST.md'),
  };
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
  saveWorkspaceProjectId,
  saveApiKey,
  promptApiKey,
  readLocalPlaneConfig,
  readCodingSpaceSettings,
  fetchProjectDetails,
  cleanHTML,
  formatPriority,
  formatDate,
  scrapeLightshotImageURL,
  scrapeStreamableMediaURLs,
  downloadFile,
  categorizeIssues,
  generateTaskListMD,
  syncProject,
};

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.includes('--set-key') || args.includes('--set-api-key')) {
    const idx = args.indexOf('--set-key') !== -1 ? args.indexOf('--set-key') : args.indexOf('--set-api-key');
    const val = args[idx + 1];
    if (val) {
      saveApiKey(val);
      process.stdout.write(`Saved Plane API key to ${CONFIG_FILE}\n`);
      process.exit(0);
    } else {
      process.stderr.write('Missing API key value after --set-key\n');
      process.exit(1);
    }
  }
}
