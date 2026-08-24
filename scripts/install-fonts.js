'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execSync } = require('node:child_process');

const FONTS = {
  cascadia: {
    name: 'CascadiaCode',
    displayName: 'CaskaydiaCove Nerd Font Mono',
    url: 'https://github.com/ryanoasis/nerd-fonts/releases/download/v3.3.0/CascadiaCode.tar.xz',
    fileName: 'CascadiaCode.tar.xz',
  },
  jetbrains: {
    name: 'JetBrainsMono',
    displayName: 'JetBrainsMono Nerd Font Mono',
    url: 'https://github.com/ryanoasis/nerd-fonts/releases/download/v3.3.0/JetBrainsMono.tar.xz',
    fileName: 'JetBrainsMono.tar.xz',
  },
  fira: {
    name: 'FiraCode',
    displayName: 'FiraCode Nerd Font Mono',
    url: 'https://github.com/ryanoasis/nerd-fonts/releases/download/v3.3.0/FiraCode.tar.xz',
    fileName: 'FiraCode.tar.xz',
  },
  meslo: {
    name: 'Meslo',
    displayName: 'MesloLGS Nerd Font Mono',
    url: 'https://github.com/ryanoasis/nerd-fonts/releases/download/v3.3.0/Meslo.tar.xz',
    fileName: 'Meslo.tar.xz',
  },
};

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const selectedKeys = args.length === 0 || args.includes('all')
  ? ['cascadia', 'jetbrains', 'fira']
  : args.map((a) => a.toLowerCase().replace(/[-_ ]/g, ''));

const tempDir = os.tmpdir();
const platform = os.platform();

let baseFontsDir;
if (platform === 'win32') {
  baseFontsDir = path.join(
    process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'),
    'Microsoft',
    'Windows',
    'Fonts'
  );
} else if (platform === 'darwin') {
  baseFontsDir = path.join(os.homedir(), 'Library', 'Fonts');
} else {
  baseFontsDir = path.join(os.homedir(), '.local', 'share', 'fonts');
}

if (!fs.existsSync(baseFontsDir)) {
  fs.mkdirSync(baseFontsDir, { recursive: true });
}

for (const key of selectedKeys) {
  const font = FONTS[key] || FONTS[Object.keys(FONTS).find((k) => FONTS[k].name.toLowerCase().includes(key))];
  if (!font) {
    console.warn(`Unknown font key "${key}". Available: ${Object.keys(FONTS).join(', ')}`);
    continue;
  }

  const tarFile = path.join(tempDir, font.fileName);
  const extractDir = path.join(tempDir, `${font.name}_Extracted`);

  if (!fs.existsSync(tarFile)) {
    console.log(`Downloading ${font.displayName} (${font.url})...`);
    try {
      execSync(`curl -fsSL "${font.url}" -o "${tarFile}"`, { stdio: 'inherit' });
    } catch (err) {
      console.error(`Failed to download ${font.name}:`, err.message);
      continue;
    }
  }

  if (!fs.existsSync(extractDir)) {
    fs.mkdirSync(extractDir, { recursive: true });
  }

  console.log(`Extracting ${font.name}...`);
  try {
    execSync(`tar -xf "${tarFile}" -C "${extractDir}"`, { stdio: 'inherit' });
  } catch (err) {
    console.error(`Failed to extract ${font.name}:`, err.message);
    continue;
  }

  const files = fs.readdirSync(extractDir);
  const ttfFiles = files.filter((f) => f.endsWith('.ttf') || f.endsWith('.otf'));
  console.log(`Found ${ttfFiles.length} font files for ${font.name}.`);

  for (const f of ttfFiles) {
    const src = path.join(extractDir, f);
    const dst = path.join(baseFontsDir, f);
    fs.copyFileSync(src, dst);

    if (platform === 'win32') {
      const fontName = f.replace(/\.(ttf|otf)$/i, '') + ' (TrueType)';
      try {
        const regCmd = `reg add "HKCU\\Software\\Microsoft\\Windows NT\\CurrentVersion\\Fonts" /v "${fontName}" /t REG_SZ /d "${dst}" /f`;
        execSync(regCmd, { stdio: 'ignore' });
      } catch (err) {
        // ignore registration errors
      }
    }
  }

  console.log(`✔ ${font.displayName} installed.`);
}

if (platform === 'linux') {
  try {
    console.log('Updating fontconfig cache...');
    execSync(`fc-cache -fv "${baseFontsDir}"`, { stdio: 'inherit' });
  } catch (err) {
    console.warn('Could not run fc-cache:', err.message);
  }
}

console.log(`\nAll fonts successfully installed to ${baseFontsDir}!`);
console.log('Recommended terminal font setting: "CaskaydiaCove Nerd Font Mono" or "JetBrainsMono Nerd Font Mono"');


