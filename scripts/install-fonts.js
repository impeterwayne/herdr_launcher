'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execSync } = require('node:child_process');

const tempDir = os.tmpdir();
const tarFile = path.join(tempDir, 'JetBrainsMono.tar.xz');
const extractDir = path.join(tempDir, 'JetBrainsMono_Extracted');

if (!fs.existsSync(extractDir)) {
  fs.mkdirSync(extractDir, { recursive: true });
}

console.log('Extracting', tarFile, 'to', extractDir);
execSync(`tar -xf "${tarFile}" -C "${extractDir}"`, { stdio: 'inherit' });

const fontsDir = path.join(process.env.LOCALAPPDATA, 'Microsoft', 'Windows', 'Fonts');
if (!fs.existsSync(fontsDir)) {
  fs.mkdirSync(fontsDir, { recursive: true });
}

const files = fs.readdirSync(extractDir);
const ttfFiles = files.filter(f => f.endsWith('.ttf'));
console.log(`Found ${ttfFiles.length} TTF font files.`);

for (const f of ttfFiles) {
  const src = path.join(extractDir, f);
  const dst = path.join(fontsDir, f);
  fs.copyFileSync(src, dst);
  console.log(`Copied: ${f} -> ${dst}`);

  // Register in HKCU font registry
  const fontName = f.replace(/\.ttf$/i, '') + ' (TrueType)';
  try {
    const regCmd = `reg add "HKCU\\Software\\Microsoft\\Windows NT\\CurrentVersion\\Fonts" /v "${fontName}" /t REG_SZ /d "${dst}" /f`;
    execSync(regCmd, { stdio: 'ignore' });
  } catch (err) {
    console.error(`Failed to register ${fontName}:`, err.message);
  }
}

console.log('Fonts successfully installed and registered in Windows registry.');
