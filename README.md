# Herdr Research & Documentation Archive

This repository contains comprehensive research, deep-wiki documentation, and blog article archives for **Herdr** (AI Agent-first terminal / multiplexer orchestration environment).

## Structure

- **`docs/deepwiki/herdrdev_herdr/`**: Complete 48-chapter DeepWiki architecture documentation covering app orchestration, headless client-server protocol, terminal emulation, agent integration, PTY runtimes, plugin system, remote sessions, and configuration.
- **`docs/blog/`**: Crawled blog deep-dive articles and analysis.
- **`plugins/herdr-launcher/`**: CodingSpace-style launcher and sidebar plugin for Herdr.
- **`scripts/`**: Automation and crawler utility scripts.

## Font Requirement / Prerequisites

The `herdr-launcher` TUI and status indicators rely on Nerd Font v3+ glyphs (FontAwesome, Material Design Icons, Codicons, Devicons). To avoid tofu blocks or missing icons:

1. **Download & Install**: Download a patched Nerd Font such as [JetBrainsMono Nerd Font](https://www.nerdfonts.com/font-downloads) (or from [Nerd Fonts Releases](https://github.com/ryanoasis/nerd-fonts/releases)).
2. **Configure Terminal**: In your terminal emulator (e.g. Windows Terminal, WezTerm, Alacritty), set your font face to **`JetBrainsMono NF`** or **`JetBrainsMono Nerd Font`**.
3. **ASCII Fallback**: If you prefer not to install a patched font, run the launcher with `--ascii-icons` or configure `{"style": "ascii"}` in `%APPDATA%\herdr\plugins\herdr-launcher\icons.json`.

