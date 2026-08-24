# herdr-launcher

**English** | [Tiếng Việt](README.vi.md)

A lightweight productivity sidebar and fast agent launcher for [Herdr](https://github.com/herdrdev/herdr).

---

## Features

![herdr-launcher](assets/screenshot.png)

---

## Installation & Setup

### 1. Clone the Repository
```bash
git clone https://github.com/impeterwayne/herdr_launcher.git
cd herdr_launcher
```

### 2. Link the Plugin
```bash
# Linux / macOS
herdr plugin link ./plugins/herdr-launcher

# Windows (PowerShell)
herdr plugin link .\plugins\herdr-launcher
```

### 3. Configure Keybindings
Copy `config.example.toml` into your Herdr configuration directory:
```bash
# Linux / macOS
mkdir -p ~/.config/herdr && cp plugins/herdr-launcher/config.example.toml ~/.config/herdr/config.toml

# Windows (PowerShell)
Copy-Item plugins\herdr-launcher\config.example.toml "$env:APPDATA\herdr\config.toml"
```

### 4. Reload Herdr
```bash
herdr server reload-config
```

### 5. Font & Display Setup (Optional)
The sidebar uses Nerd Font v3+ glyphs for status marks and icons. Install the recommended monospace fonts:
```bash
node scripts/install-fonts.js
# Or specify font: node scripts/install-fonts.js cascadia | jetbrains | fira | meslo
```

<details>
<summary><b>How to apply the installed font in your terminal / IDE (All Platforms)</b></summary>

Use one of the installed font names:
- `"CaskaydiaCove Nerd Font Mono"`
- `"JetBrainsMono Nerd Font Mono"`
- `"FiraCode Nerd Font Mono"`
- `"MesloLGS Nerd Font Mono"`

#### Antigravity IDE / VS Code (*All Platforms*)
Add to `settings.json` (<kbd>Ctrl</kbd>/<kbd>Cmd</kbd> + <kbd>Shift</kbd> + <kbd>P</kbd> → *Preferences: Open User Settings (JSON)*):
```json
{
  "terminal.integrated.fontFamily": "'CaskaydiaCove Nerd Font Mono', monospace"
}
```

#### Windows (Windows Terminal)
1. Open Windows Terminal → press <kbd>Ctrl</kbd> + <kbd>,</kbd> (Settings).
2. Go to **Profiles** → **Defaults** → **Appearance**.
3. Set **Font face** to `CaskaydiaCove Nerd Font Mono` → **Save**.

#### Linux (GNOME / Default Terminal)
1. Open Terminal → **Preferences** (menu **☰**).
2. Under your profile → **Text** tab → check **Custom font**.
3. Select `CaskaydiaCove Nerd Font Mono Regular`.

#### macOS (Terminal.app / iTerm2)
- **Terminal.app**: <kbd>Cmd</kbd> + <kbd>,</kbd> → **Profiles** → **Font** → **Change** → select `CaskaydiaCove Nerd Font Mono`.
- **iTerm2**: <kbd>Cmd</kbd> + <kbd>,</kbd> → **Profiles** → **Text** → set **Font** to `CaskaydiaCove Nerd Font Mono`.

#### Config Files (CLI Terminals)
- **Kitty** (`~/.config/kitty/kitty.conf`):
  ```conf
  font_family CaskaydiaCove Nerd Font Mono
  ```
- **Alacritty** (`~/.config/alacritty/alacritty.toml`):
  ```toml
  [font.normal]
  family = "CaskaydiaCove Nerd Font Mono"
  ```
- **WezTerm** (`~/.wezterm.lua`):
  ```lua
  config.font = wezterm.font("CaskaydiaCove Nerd Font Mono")
  ```

</details>

> **ASCII Fallback**: If you prefer not to install custom fonts, pass `--ascii-icons` or configure `{"style": "ascii"}` in `<config-dir>/icons.json` to render clean two-letter badges (`[AG]`, `[VS]`, `[SM]`, `[PL]`).

### 6. Verify Installation
```bash
node scripts/self-test.js
```

---

## Keybindings

`prefix` defaults to `ctrl+b`. All individual launchers use `prefix+alt` combinations to prevent accidental triggers during normal typing.

| Key | Action |
| :--- | :--- |
| `prefix+l` | Toggle docked sidebar (right edge) |
| `prefix+m` | Toggle Stack Mode (maximize pane + keep sidebar) |
| `prefix+alt+a` | Antigravity CLI (`--dangerously-skip-permissions`) |
| `prefix+alt+c` | Claude Code (`--dangerously-skip-permissions`) |
| `prefix+alt+shift+c` | Codex (`--dangerously-bypass-approvals-and-sandbox`) |
| `prefix+alt+o` | OpenCode (`--auto`) |
| `prefix+alt+t` | Native Terminal pane |
| `prefix+alt+l` | Symlinks workspace tool |
| `prefix+alt+s` | OpenSpec setup tool |
| `prefix+alt+p` | Plane tasks tool |
| `prefix+alt+v` | Open VS Code in active directory |
| `prefix+alt+e` | Reveal active directory in File Explorer |

---

## Configuration Reference

Configuration files live in the Herdr plugin config directory (`~/.config/herdr/plugins/config/herdr-launcher/` or `%APPDATA%\herdr\plugins\config\herdr-launcher\`):

- **`plane.json`**: Plane API credentials and workspace mappings:
  ```json
  {
    "baseUrl": "https://plane.example.com",
    "workspaceSlug": "product",
    "apiKey": "plane_api_...",
    "projectPlaneIds": {
      "/path/to/workspace": "project-uuid"
    }
  }
  ```
- **`apps.json`**: Custom executable paths:
  ```json
  {
    "android-studio": "C:\\Program Files\\Android\\Android Studio\\bin\\studio64.exe",
    "vscode": "/usr/bin/code"
  }
  ```
- **`symlinks.json`**: Persistent symlink targets:
  ```json
  {
    "targets": [
      { "name": "assets", "targetPath": "/shared/assets" }
    ]
  }
  ```
- **`icons.json`**: Display style:
  ```json
  {
    "style": "ascii"
  }
  ```

---

## Testing & Quality Assurance

Run the comprehensive self-test suite (150+ assertions covering syntax, manifest validation, dry-run commands, mouse tracking, and tools):

```bash
node scripts/self-test.js
```
