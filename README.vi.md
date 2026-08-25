# herdr-launcher

[English](README.md) | **Tiếng Việt**

Một thanh bên (sidebar) tăng năng suất gọn nhẹ và trình khởi chạy agent tốc độ cao dành cho [Herdr](https://github.com/herdrdev/herdr).

---

## Tính năng

![herdr-launcher](assets/screenshot.png)

---

## Cài đặt & Thiết lập

### 1. Clone Kho lưu trữ
```bash
git clone https://github.com/impeterwayne/herdr_launcher.git
cd herdr_launcher
```

### 2. Liên kết Plugin
```bash
# Linux / macOS
herdr plugin link ./plugins/herdr-launcher

# Windows (PowerShell)
herdr plugin link .\plugins\herdr-launcher
```

### 3. Cấu hình Phím tắt
Sao chép `config.example.toml` vào thư mục cấu hình Herdr của bạn:
```bash
# Linux / macOS
mkdir -p ~/.config/herdr && cp plugins/herdr-launcher/config.example.toml ~/.config/herdr/config.toml

# Windows (PowerShell)
Copy-Item plugins\herdr-launcher\config.example.toml "$env:APPDATA\herdr\config.toml"
```

### 4. Tải lại Herdr
```bash
herdr server reload-config
```

### 5. Cài đặt Font & Hiển thị (Tùy chọn)
Thanh bên sử dụng các ký tự Nerd Font v3+ cho các biểu tượng và ký hiệu trạng thái. Cài đặt các font monospace khuyến nghị:
```bash
node scripts/install-fonts.js
# Hoặc chỉ định font: node scripts/install-fonts.js cascadia | jetbrains | fira | meslo
```

<details>
<summary><b>Cách áp dụng font đã cài đặt vào terminal / IDE (Tất cả nền tảng)</b></summary>

Sử dụng một trong các tên font đã cài đặt:
- `"CaskaydiaCove Nerd Font Mono"`
- `"JetBrainsMono Nerd Font Mono"`
- `"FiraCode Nerd Font Mono"`
- `"MesloLGS Nerd Font Mono"`

#### Antigravity IDE / VS Code (*Tất cả nền tảng*)
Thêm vào `settings.json` (<kbd>Ctrl</kbd>/<kbd>Cmd</kbd> + <kbd>Shift</kbd> + <kbd>P</kbd> → *Preferences: Open User Settings (JSON)*):
```json
{
  "terminal.integrated.fontFamily": "'CaskaydiaCove Nerd Font Mono', monospace"
}
```

#### Windows (Windows Terminal)
1. Mở Windows Terminal → nhấn <kbd>Ctrl</kbd> + <kbd>,</kbd> (Cài đặt / Settings).
2. Vào **Profiles** → **Defaults** → **Appearance**.
3. Đặt **Font face** thành `CaskaydiaCove Nerd Font Mono` → **Save**.

#### Linux (GNOME / Terminal mặc định)
1. Mở Terminal → **Preferences** (menu **☰**).
2. Trong profile của bạn → tab **Text** → tích chọn **Custom font**.
3. Chọn `CaskaydiaCove Nerd Font Mono Regular`.

#### macOS (Terminal.app / iTerm2)
- **Terminal.app**: <kbd>Cmd</kbd> + <kbd>,</kbd> → **Profiles** → **Font** → **Change** → chọn `CaskaydiaCove Nerd Font Mono`.
- **iTerm2**: <kbd>Cmd</kbd> + <kbd>,</kbd> → **Profiles** → **Text** → đặt **Font** thành `CaskaydiaCove Nerd Font Mono`.

#### Tệp cấu hình (CLI Terminals)
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

> **Chế độ ASCII Fallback**: Nếu bạn không muốn cài đặt font ngoài, hãy truyền cờ `--ascii-icons` hoặc cấu hình `{"style": "ascii"}` trong `<config-dir>/icons.json` để hiển thị các huy hiệu 2 chữ cái gọn gàng (`[AG]`, `[VS]`, `[SM]`, `[PL]`).

### 6. Kiểm tra Cài đặt
```bash
node scripts/self-test.js
```

---

## Phím tắt

Phím `prefix` mặc định là `ctrl+b`. Tất cả các phím tắt khởi chạy riêng lẻ sử dụng tổ hợp `prefix+alt` nhằm tránh vô tình kích hoạt khi gõ phím thông thường.

| Phím | Thao tác thực hiện |
| :--- | :--- |
| `prefix+alt+space` | Bật / tắt thanh bên gắn cạnh phải (sidebar) |
| `prefix+alt+m` | Bật / tắt Chế độ Ngăn xếp (Stack Mode - phóng to pane & giữ sidebar) |
| `prefix+alt+a` | Antigravity CLI (`--dangerously-skip-permissions`) |
| `prefix+alt+c` | Claude Code (`--dangerously-skip-permissions`) |
| `prefix+alt+shift+c` | Codex (`--dangerously-bypass-approvals-and-sandbox`) |
| `prefix+alt+o` | OpenCode (`--auto`) |
| `prefix+alt+t` | Khung Terminal nội tại (Native PTY) |
| `prefix+alt+y` | Công cụ quản lý Symlinks cho workspace |
| `prefix+alt+s` | Công cụ thiết lập OpenSpec |
| `prefix+alt+p` | Công cụ quản lý công việc Plane |
| `prefix+alt+v` | Mở VS Code tại thư mục đang hoạt động |
| `prefix+alt+e` | Mở File Explorer / Finder tại thư mục đang hoạt động |

---

## Tài liệu Cấu hình

Các tệp cấu hình nằm trong thư mục cấu hình plugin của Herdr (`~/.config/herdr/plugins/config/herdr-launcher/` hoặc `%APPDATA%\herdr\plugins\config\herdr-launcher\`):

- **`plane.json`**: Thông tin xác thực Plane API và ánh xạ workspace:
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
- **`apps.json`**: Đường dẫn tùy chỉnh tới các tệp thực thi:
  ```json
  {
    "android-studio": "C:\\Program Files\\Android\\Android Studio\\bin\\studio64.exe",
    "vscode": "/usr/bin/code"
  }
  ```
- **`symlinks.json`**: Danh sách thư mục liên kết cố định:
  ```json
  {
    "targets": [
      { "name": "assets", "targetPath": "/shared/assets" }
    ]
  }
  ```
- **`icons.json`**: Kiểu hiển thị biểu tượng:
  ```json
  {
    "style": "ascii"
  }
  ```

---

## Kiểm thử & Đảm bảo Chất lượng

Chạy bộ tự kiểm thử toàn diện (hơn 150+ ca kiểm tra bao gồm cú pháp, tính hợp lệ của manifest, các lệnh dry-run, sự kiện chuột và công cụ):

```bash
node scripts/self-test.js
```
