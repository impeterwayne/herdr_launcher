# herdr-launcher

[English](README.md) | **Tiếng Việt**

Thanh bên (sidebar) tăng hiệu suất làm việc gọn nhẹ và trình khởi chạy AI coding agent tốc độ cao dành cho [Herdr](https://github.com/herdrdev/herdr).

Khởi chạy các coding agent AI ở chế độ tự động hóa ("YOLO mode" / bỏ qua xác nhận quyền) chỉ với một phím tắt duy nhất, đồng thời quản lý trực tiếp các công cụ không gian làm việc (Symlinks, OpenSpec, Plane) và ứng dụng desktop ngay từ thanh bên gắn cố định bên phải (right-docked sidebar).

**Không phụ thuộc vào thư viện npm bên ngoài (Zero npm dependencies)** — được viết hoàn toàn bằng CommonJS tiêu chuẩn chạy trực tiếp trên Node.js. Đã kiểm thử và hoạt động ổn định trên Linux, macOS và Windows 11.

---

## Tính năng nổi bật

![herdr-launcher](assets/screenshot.png)

- **Trình khởi chạy Agent YOLO**: Bật ngay các AI agent (Antigravity CLI, Claude Code, Codex, OpenCode, Terminal) chỉ với 1 tổ hợp phím tắt, tự động kích hoạt cờ bỏ qua xác nhận quyền.
- **Thanh bên cố định bên phải (Right-Docked Sidebar)**: Chiều rộng cố định 20 cột, hiển thị trực quan và chuyển đổi mượt mà giữa menu chính và các công cụ con mà không dùng popup.
- **Hỗ trợ thao tác Chuột & Bàn phím đầy đủ**: Điều hướng bằng phím mũi tên, phím Vim (`j`/`k`), click chuột, double-click và cuộn chuột mượt mà.
- **Quản lý Symlink thông minh**: Tự động phát hiện các Git worktree lân cận và tạo liên kết (NTFS junction trên Windows không cần quyền Admin, Symlink trên Unix) cho các thư mục nặng như `node_modules`, `build`, `.venv`, `.gradle`.
- **Tích hợp Plane Tasks & Evidence Sync**: Xem danh sách công việc trên Plane, tải về tài liệu Markdown ngoại tuyến và tự động tải ảnh/video bằng chứng vào thư mục dự án.
- **Tích hợp bộ công cụ OpenSpec**: Cài đặt và quản lý các thành phần OpenSpec đi kèm, tự động cập nhật `.git/info/exclude`.
- **Chế độ Ngăn xếp (Stack Mode)**: Phóng to khung làm việc chính chiếm ~90% chiều rộng tab trong khi vẫn giữ thanh launcher cố định bên phải.
- **Trình mở ứng dụng Desktop**: Mở nhanh VS Code, Antigravity IDE, Android Studio, File Explorer / Finder tại thư mục hiện hành.

---

## Cài đặt & Thiết lập

### 1. Clone kho lưu trữ
```bash
git clone https://github.com/impeterwayne/herdr_launcher.git
cd herdr_launcher
```

### 2. Liên kết Plugin với Herdr
```bash
# Linux / macOS
herdr plugin link ./plugins/herdr-launcher

# Windows (PowerShell)
herdr plugin link .\plugins\herdr-launcher
```

### 3. Cấu hình Phím tắt
Sao chép tệp mẫu `config.example.toml` vào thư mục cấu hình Herdr của bạn:
```bash
# Linux / macOS
mkdir -p ~/.config/herdr && cp plugins/herdr-launcher/config.example.toml ~/.config/herdr/config.toml

# Windows (PowerShell)
Copy-Item plugins\herdr-launcher\config.example.toml "$env:APPDATA\herdr\config.toml"
```

### 4. Tải lại cấu hình Herdr
```bash
herdr server reload-config
```

### 5. Cài đặt Font & Hiển thị (Tùy chọn)
Thanh bên sử dụng các ký tự biểu tượng Nerd Font v3+ cho các biểu tượng và ký hiệu trạng thái. Bạn có thể cài đặt nhanh các font monospace khuyến nghị bằng script tích hợp:
```bash
node scripts/install-fonts.js
# Hoặc chỉ định font cụ thể: node scripts/install-fonts.js cascadia | jetbrains | fira | meslo
```

<details>
<summary><b>Cách áp dụng font đã cài đặt vào Terminal / IDE (Tất cả nền tảng)</b></summary>

Sử dụng một trong các tên font sau:
- `"CaskaydiaCove Nerd Font Mono"`
- `"JetBrainsMono Nerd Font Mono"`
- `"FiraCode Nerd Font Mono"`
- `"MesloLGS Nerd Font Mono"`

#### Antigravity IDE / VS Code (*Tất cả hệ điều hành*)
Thêm dòng sau vào `settings.json` (<kbd>Ctrl</kbd>/<kbd>Cmd</kbd> + <kbd>Shift</kbd> + <kbd>P</kbd> → *Preferences: Open User Settings (JSON)*):
```json
{
  "terminal.integrated.fontFamily": "'CaskaydiaCove Nerd Font Mono', monospace"
}
```

#### Windows (Windows Terminal)
1. Mở Windows Terminal → nhấn <kbd>Ctrl</kbd> + <kbd>,</kbd> (Cài đặt / Settings).
2. Vào mục **Profiles** → **Defaults** → **Appearance**.
3. Đổi **Font face** thành `CaskaydiaCove Nerd Font Mono` → chọn **Save**.

#### Linux (GNOME / Terminal mặc định)
1. Mở Terminal → vào **Preferences** (menu **☰**).
2. Chọn profile của bạn → tab **Text** → tích chọn **Custom font**.
3. Chọn font `CaskaydiaCove Nerd Font Mono Regular`.

#### macOS (Terminal.app / iTerm2)
- **Terminal.app**: <kbd>Cmd</kbd> + <kbd>,</kbd> → **Profiles** → **Font** → **Change** → chọn `CaskaydiaCove Nerd Font Mono`.
- **iTerm2**: <kbd>Cmd</kbd> + <kbd>,</kbd> → **Profiles** → **Text** → đặt **Font** thành `CaskaydiaCove Nerd Font Mono`.

#### Tệp cấu hình CLI Terminals
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

> **Chế độ ASCII Fallback**: Nếu bạn không muốn cài đặt font ngoài, bạn có thể truyền cờ `--ascii-icons` hoặc cấu hình `{"style": "ascii"}` trong tệp `<config-dir>/icons.json` để hiển thị các huy hiệu 2 ký tự gọn gàng (`[AG]`, `[VS]`, `[SM]`, `[PL]`).

### 6. Kiểm tra & Tự kiểm thử
```bash
node scripts/self-test.js
```

---

## Bảng Phím tắt

Phím `prefix` mặc định là `ctrl+b`. Tất cả các phím tắt khởi chạy riêng lẻ sử dụng tổ hợp `prefix+alt` nhằm tránh xung đột khi gõ phím thông thường.

| Phím tắt | Thao tác thực hiện |
| :--- | :--- |
| `prefix+\` | Bật / tắt thanh bên gắn cạnh phải (sidebar) |
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

## Điều khiển & Điều hướng trên Sidebar

Thanh bên hiển thị ở dạng chia khung 20 cột gắn cố định ở mép phải màn hình. Khi bạn chọn một công cụ không gian làm việc bất kỳ, giao diện công cụ sẽ mở dưới dạng cửa sổ popup tập trung.

| Thao tác | Hành động |
| :--- | :--- |
| `↑` / `↓` hoặc `j` / `k` | Di chuyển lựa chọn lên / xuống |
| `Enter` | Khởi chạy mục đã chọn / Mở popup công cụ |
| `Esc` / `[esc close]` | Đóng popup công cụ hoặc hủy hộp thoại |
| `q` / `[q quit]` | Đóng thanh bên / popup |
| `r` / `[r reload]` | Làm mới lại giao diện hiện tại |
| `Click chuột` | Chọn dòng hoặc kích hoạt nút hành động (action chip) ở chân trang |
| `Double-Click` | Thực thi ngay mục được chọn |
| `Cuộn chuột` | Cuộn danh sách độc lập với vị trí con trỏ lựa chọn |

---

## Các Coding Agent (Khởi chạy Chế độ YOLO)

Mỗi lần nhấn phím sẽ khởi chạy một phiên agent mới được cấu hình tự động bỏ qua các lời nhắc xác nhận quyền ("YOLO mode"). Các phiên làm việc được đánh số định danh duy nhất (`codex-wa-1`, `codex-wa-2`) và tích hợp trực tiếp vào hệ thống quản lý agent của Herdr (trạng thái `working`/`blocked`/`done` và tiếp tục phiên làm việc).

| Trình khởi chạy | Loại CLI | Cờ lệnh (Flags) | Lệnh cài đặt tích hợp |
| :--- | :--- | :--- | :--- |
| **Antigravity** | `agy` | `--dangerously-skip-permissions` | `herdr integration install antigravity-cli` |
| **Claude** | `claude` | `--dangerously-skip-permissions` | `herdr integration install claude` |
| **Codex** | `codex` | `--dangerously-bypass-approvals-and-sandbox` | `herdr integration install codex` |
| **OpenCode** | `opencode` | `--auto` | `herdr integration install opencode` |
| **Terminal** | `terminal` | (Interactive shell) | Tích hợp sẵn Native PTY |

*Mẹo: Truyền thêm cờ `--reuse` qua CLI để chuyển tiêu điểm (focus) vào phiên agent đã có sẵn thay vì khởi tạo một tiến trình mới.*

---

## Các công cụ Không gian làm việc (Workspace Tools)

### Symlinks (`prefix+alt+y`)
Quét các git worktree liền kề và gợi ý liên kết các thư mục nặng dùng chung (`node_modules`, `build`, `dist`, `.gradle`, `vendor`, `target`, `.venv`).
- Sử dụng **NTFS Junctions** nguyên bản trên Windows (không yêu cầu quyền Quản trị viên / Administrator hay bật Developer Mode) và **Symlinks** tiêu chuẩn trên Unix.
- Các nút hành động: `[⏎ link]` `[b browse]` `[e explore]` `[d delete]` `[r reload]` `[esc close]`.
- Bạn có thể khai báo thêm các đường dẫn liên kết tùy chỉnh trong tệp `<config-dir>/symlinks.json`.

### OpenSpec (`prefix+alt+s`)
Triển khai và bảo trì các thành phần của bộ công cụ OpenSpec đi kèm, đồng thời tự động cập nhật `.git/info/exclude` để Git bỏ qua các file artifact phát sinh.
- Bộ công cụ đi kèm nằm tại `toolkits/OpenSpec`.
- Bạn có thể ghi đè thư mục gốc của bộ công cụ qua biến môi trường `HERDR_LAUNCHER_OPENSPEC_ROOT` hoặc tệp `<config-dir>/openspec.json`.

### Plane Tasks & Đồng bộ Bằng chứng (`prefix+alt+p`)
Xem các issue trên Plane, đồng bộ có chọn lọc các tác vụ và tải dữ liệu bằng chứng (hình ảnh, video đính kèm) thành tài liệu Markdown ngoại tuyến (`plane/TASK_LIST.md`).
- **Cài đặt API Key tương tác (`k`)**: Nhập và lưu trữ an toàn API Key vào tệp `plane.json`.
- **Bộ chuyển đổi dự án tương tác (`p`)**: Duyệt và liên kết các dự án Plane tương ứng với không gian làm việc của bạn.
- **Thu thập có chọn lọc (`s`)**: Lựa chọn phạm vi công việc cần đồng bộ (`Backlog + Todo`, `Active Tasks`, `All Tasks`, v.v.). Tự động tải ảnh chụp màn hình và video về `plane/evidence/<taskId>/` và cập nhật `.git/info/exclude`.

---

## Trình mở Ứng dụng Desktop

Mở các ứng dụng desktop ở tiến trình độc lập (detached process) ngay tại thư mục của khung làm việc hiện hành và đưa cửa sổ đã có sẵn lên phía trước:
- **Antigravity IDE**: `prefix+alt+a` (hoặc thông qua menu)
- **Android Studio**: thông qua menu
- **VS Code**: `prefix+alt+v`
- **File Explorer / Finder**: `prefix+alt+e`

*Bạn có thể tùy chỉnh đường dẫn tệp thực thi trong `<config-dir>/apps.json` nếu ứng dụng được cài đặt ở thư mục không mặc định.*

---

## Chế độ Ngăn xếp (Stack Mode - `prefix+alt+m`)

Chuyển đổi kích thước khung làm việc hoặc agent đang hoạt động để chiếm khoảng **~90% chiều rộng tab**, trong khi vẫn giữ thanh bên launcher 20 cột cố định ở mép phải. Nhấn lại `prefix+alt+m` để khôi phục bố cục cân bằng ban đầu.

---

## Giao diện dòng lệnh & Các lệnh CLI độc lập

Tất cả các script trong thư mục `bin/` đều hỗ trợ cờ `--dry-run` để xuất kết quả dạng JSON mà không làm thay đổi trạng thái phiên:

```bash
# Bật/tắt hoặc gắn thanh bên
node bin/toggle-launcher.js [--cols 20] [--open|--close] [--dry-run]

# Khởi chạy các công cụ workspace
node bin/tool-launch.js <symlinks|openspec|plane> [--dry-run]

# Khởi chạy coding agent
node bin/agent-launch.js <agy-yolo|claude-danger|codex-yolo|opencode-auto|terminal> [--reuse] [--dry-run]

# Mở ứng dụng desktop
node bin/app-open.js <antigravity|android-studio|vscode|explorer> [path] [--dry-run]

# Chuyển đổi chế độ Stack Mode
node bin/stack-mode.js [--toggle|--on|--off] [--dry-run]

# Quản lý tự động gắn thanh bên vào các tab
node bin/watch-tabs.js [--start|--stop|--status|--once] [--dry-run]

# Chạy quy trình tiếp nhận khi khởi động
node bin/startup.js [--dry-run]
```

---

## Tài liệu Cấu hình

Các tệp cấu hình được đặt trong thư mục cấu hình plugin của Herdr (`~/.config/herdr/plugins/config/herdr-launcher/` trên Linux/macOS hoặc `%APPDATA%\herdr\plugins\config\herdr-launcher\` trên Windows):

- **`plane.json`**: Cấu hình thông tin API Plane và ánh xạ dự án:
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
- **`apps.json`**: Đường dẫn tùy chỉnh tới các tệp thực thi ứng dụng:
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
- **`panes/<pane-id>.json`**: do plugin tự ghi, không phải để bạn sửa. Mỗi launcher đang chạy ghi lại pane và pid của nó ở đây để các lượt dock phân biệt được sidebar còn sống với sidebar đã chết — trên Windows, `pane process-info` của herdr chỉ báo shell của pane, nên nếu không có bản ghi này thì một launcher đang chạy bị xem như shell rỗng và bị gõ lại câu lệnh khởi chạy vào chính nó. Các bản ghi được dọn khi khởi động.

---

## Kiểm thử & Đảm bảo Chất lượng

Chạy bộ tự kiểm thử toàn diện (hơn 160+ ca kiểm tra bao gồm cú pháp, tính hợp lệ của manifest, lệnh dry-run, sự kiện chuột và các công cụ):

```bash
node scripts/self-test.js
```
