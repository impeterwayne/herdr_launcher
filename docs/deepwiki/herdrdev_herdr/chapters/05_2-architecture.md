---
title: "Architecture"
chapter: 5
source_url: "https://deepwiki.com/herdrdev/herdr/2-architecture"
word_count: 866
mermaid_diagrams: 3
---

# Architecture

<details>
<summary>Relevant source files</summary>

The following files were used as context for generating this wiki page:

- [src/app/actions.rs](https://github.com/herdrdev/herdr/blob/HEAD/src/app/actions.rs)
- [src/app/api.rs](https://github.com/herdrdev/herdr/blob/HEAD/src/app/api.rs)
- [src/app/mod.rs](https://github.com/herdrdev/herdr/blob/HEAD/src/app/mod.rs)
- [src/app/state.rs](https://github.com/herdrdev/herdr/blob/HEAD/src/app/state.rs)
- [src/config.rs](https://github.com/herdrdev/herdr/blob/HEAD/src/config.rs)
- [src/config/model.rs](https://github.com/herdrdev/herdr/blob/HEAD/src/config/model.rs)
- [src/events.rs](https://github.com/herdrdev/herdr/blob/HEAD/src/events.rs)
- [src/main.rs](https://github.com/herdrdev/herdr/blob/HEAD/src/main.rs)
- [src/server/headless.rs](https://github.com/herdrdev/herdr/blob/HEAD/src/server/headless.rs)
- [src/server/render_stream.rs](https://github.com/herdrdev/herdr/blob/HEAD/src/server/render_stream.rs)
- [src/ui.rs](https://github.com/herdrdev/herdr/blob/HEAD/src/ui.rs)

</details>



Herdr utilizes a client/server architecture designed to provide persistent terminal sessions that survive client disconnects, remote SSH sessions, and even live handoffs between server processes. The system is built around a central event loop that orchestrates state mutations, PTY I/O, and a virtual rendering pipeline.

## System Overview

The following diagram illustrates the high-level relationship between the `HeadlessServer`, the `App` orchestration layer, and the external `Client` connections.

### Core Component Interaction
```mermaid
graph TD
    subgraph Headless_Server_Space_src_server_headles ["Headless Server Space (src/server/headless.rs)"]
        Server["HeadlessServer Loop"]
        ClientConn["ClientConnection"]
    end

    subgraph Application_Core_src_app_mod_rs ["Application Core (src/app/mod.rs)"]
        App["App Struct"]
        AppState["AppState (Data)"]
        EventLoop["tokio::select! Loop"]
    end

    subgraph Terminal_Subsystem_src_terminal_mod_rs ["Terminal Subsystem (src/terminal/mod.rs)"]
        Registry["TerminalRuntimeRegistry"]
        PTY["PaneRuntime / PTY"]
    end

    subgraph External_Space ["External Space"]
        Client["herdr client (Binary)"]
        Socket["herdr-client.sock"]
    end

    Client <--> Socket
    Socket <--> ClientConn
    ClientConn -- "Input Events" --> EventLoop
    EventLoop -- "Mutate" --> AppState
    App -- "Manages" --> Registry
    Registry -- "I/O" --> PTY
    App -- "Render" --> Server
    Server -- "Encoded Frames" --> ClientConn
```
**Sources:** [src/app/mod.rs:97-156](https://github.com/herdrdev/herdr/blob/HEAD/src/app/mod.rs#L97-L156), [src/server/headless.rs:1-15](https://github.com/herdrdev/herdr/blob/HEAD/src/server/headless.rs#L1-L15), [src/server/headless.rs:124-130](https://github.com/herdrdev/herdr/blob/HEAD/src/server/headless.rs#L124-L130).

---

## App Orchestration and State Management

The `App` struct [src/app/mod.rs:97-156](https://github.com/herdrdev/herdr/blob/HEAD/src/app/mod.rs#L97-L156) is the central orchestrator. It holds the `AppState` [src/app/state.rs:270-345](https://github.com/herdrdev/herdr/blob/HEAD/src/app/state.rs#L270-L345), which contains the pure data representation of workspaces, tabs, and panes. The `App` manages the main event loop using `tokio::select!`, which handles:
*   **Internal Events:** Delivered via `mpsc` channel (e.g., PTY exits, agent detection) [src/events.rs:56-162](https://github.com/herdrdev/herdr/blob/HEAD/src/events.rs#L56-L162).
*   **API Requests:** JSON-RPC calls from the CLI or plugins [src/app/mod.rs:105](https://github.com/herdrdev/herdr/blob/HEAD/src/app/mod.rs#L105).
*   **Raw Input:** Keyboard and mouse data from the connected client [src/app/mod.rs:108](https://github.com/herdrdev/herdr/blob/HEAD/src/app/mod.rs#L108).
*   **Timers:** Debounced session saving and git status refreshes [src/app/mod.rs:36-47](https://github.com/herdrdev/herdr/blob/HEAD/src/app/mod.rs#L36-L47).

### App Event Loop
```mermaid
graph TD
    subgraph App_src_app_mod_rs ["App (src/app/mod.rs)"]
        AppStruct["App"]
        AppStateStruct["AppState"]
        EventTx["mpsc::Sender<AppEvent>"]
        EventRx["mpsc::Receiver<AppEvent>"]
        ApiRx["mpsc::UnboundedReceiver<ApiRequestMessage>"]
        InputRx["mpsc::Receiver<RawInputEvent>"]
        RenderNotify["Arc<Notify>"]
        RenderDirty["Arc<RenderSignal>"]
    end

    subgraph Event_Sources ["Event Sources"]
        InternalEvents["Internal Events (AppEvent)"]
        ApiRequests["API Requests (ApiRequestMessage)"]
        RawInputEvents["Raw Input (RawInputEvent)"]
        Timers["Timers"]
        RenderRequests["RenderSignal"]
    end

    subgraph Main_Loop_tokio_select ["Main Loop (tokio::select!)"]
        Loop["LoopEvent (enum)"]
        DrainHandleRender["Drain-Handle-Render Cycle"]
    end

    InternalEvents --> EventTx
    ApiRequests --> ApiRx
    RawInputEvents --> InputRx
    RenderRequests --> RenderDirty

    EventTx --> EventRx
    EventRx --> Loop
    ApiRx --> Loop
    InputRx --> Loop
    Timers --> Loop
    RenderDirty --> RenderRequests

    Loop -- "Process" --> DrainHandleRender
    DrainHandleRender -- "Mutate" --> AppStateStruct
    DrainHandleRender -- "Update UI" --> RenderNotify
    AppStruct -- "Contains" --> AppStateStruct
    AppStruct -- "Manages" --> EventTx
    AppStruct -- "Manages" --> EventRx
    AppStruct -- "Manages" --> ApiRx
    AppStruct -- "Manages" --> InputRx
    AppStruct -- "Manages" --> RenderNotify
    AppStruct -- "Manages" --> RenderDirty
```
**Sources:** [src/app/mod.rs:97-156](https://github.com/herdrdev/herdr/blob/HEAD/src/app/mod.rs#L97-L156), [src/app/mod.rs:161-168](https://github.com/herdrdev/herdr/blob/HEAD/src/app/mod.rs#L161-L168), [src/app/state.rs:270-345](https://github.com/herdrdev/herdr/blob/HEAD/src/app/state.rs#L270-L345), [src/events.rs:56-162](https://github.com/herdrdev/herdr/blob/HEAD/src/events.rs#L56-L162).

For details, see [App Orchestration and State Management](06_2.1-app-orchestration-and-state-management.md).

---

## Headless Server and Client Protocol

Herdr runs a `HeadlessServer` [src/server/headless.rs:1-15](https://github.com/herdrdev/herdr/blob/HEAD/src/server/headless.rs#L1-L15) that maintains the session even when no UI is visible. It performs "virtual rendering" into a memory buffer using Ratatui. When a client attaches via the Unix domain socket (`herdr-client.sock`), the server begins streaming frames.

The system supports two rendering modes:
1.  **SemanticFrame:** Sends the full logical grid state, allowing the client to handle rendering [src/server/render_stream.rs:14-15](https://github.com/herdrdev/herdr/blob/HEAD/src/server/render_stream.rs#L14-L15).
2.  **TerminalAnsi:** Uses a `BlitEncoder` [src/server/render_stream.rs:17-21](https://github.com/herdrdev/herdr/blob/HEAD/src/server/render_stream.rs#L17-L21) to calculate a diff between the current and previous frame, sending only the minimal ANSI escape sequences required to update the host terminal.

### Client-Server Rendering Pipeline
```mermaid
graph TD
    subgraph Server_HeadlessServer ["Server (HeadlessServer)"]
        App["App (AppState, TerminalRuntimes)"]
        VirtualBackend["ratatui::backend::TestBackend"]
        RenderFn["ui::render(App, Frame)"]
        FrameData["protocol::FrameData"]
        ClientRenderState["ClientRenderState (Semantic/TerminalAnsi)"]
        PreparedRender["PreparedRender (ServerMessage)"]
        ClientWriter["ClientWriter (TCP/Unix Socket)"]
    end

    subgraph Client ["Client"]
        ClientApp["herdr client"]
        ClientReader["ClientReader"]
        ClientRenderer["Client-side Renderer"]
    end

    App -- "compute_view" --> VirtualBackend
    VirtualBackend -- "render" --> RenderFn
    RenderFn -- "produces" --> FrameData
    FrameData -- "prepare_frame" --> ClientRenderState
    ClientRenderState -- "generates" --> PreparedRender
    PreparedRender -- "sends via" --> ClientWriter
    ClientWriter -- "network" --> ClientReader
    ClientReader -- "receives" --> ClientApp
    ClientApp -- "displays" --> ClientRenderer
```
**Sources:** [src/server/headless.rs:1-15](https://github.com/herdrdev/herdr/blob/HEAD/src/server/headless.rs#L1-L15), [src/server/render_stream.rs:13-34](https://github.com/herdrdev/herdr/blob/HEAD/src/server/render_stream.rs#L13-L34), [src/server/render_stream.rs:65-110](https://github.com/herdrdev/herdr/blob/HEAD/src/server/render_stream.rs#L65-L110), [src/ui.rs:111-120](https://github.com/herdrdev/herdr/blob/HEAD/src/ui.rs#L111-L120).

For details, see [Headless Server and Client Protocol](07_2.2-headless-server-and-client-protocol.md).

---

## PTY and Terminal Runtime

Each terminal pane in Herdr is backed by a `PaneRuntime`. This runtime manages the lifecycle of the PTY (Pseudo-Terminal) and the underlying shell process. The `TerminalRuntimeRegistry` [src/app/mod.rs:103](https://github.com/herdrdev/herdr/blob/HEAD/src/app/mod.rs#L103) tracks these runtimes, ensuring that I/O actors continue to process shell output and update the internal Ghostty-based VT engine even when the pane is not actively being viewed.

For details, see [PTY and Terminal Runtime](08_2.3-pty-and-terminal-runtime.md).

**Sources:** [src/app/mod.rs:103](https://github.com/herdrdev/herdr/blob/HEAD/src/app/mod.rs#L103), [src/terminal/mod.rs:1-20](https://github.com/herdrdev/herdr/blob/HEAD/src/terminal/mod.rs#L1-L20).

---

## Layout Engine

Herdr uses a Binary Space Partitioning (BSP) tree to manage pane layouts within a tab. The layout is defined by `Node` structures that can be either a `Leaf` (containing a `PaneId`) or an `Internal` split (Horizontal or Vertical). The engine handles complex operations like:
*   **Splitting/Resizing:** Dynamically adjusting `Rect` geometries [src/ui.rs:111-120](https://github.com/herdrdev/herdr/blob/HEAD/src/ui.rs#L111-L120).
*   **Zooming:** Temporarily expanding a single pane to fill the tab surface.
*   **Geometry Reconciliation:** Ensuring the PTY size matches the calculated UI `Rect` [src/ui.rs:158-172](https://github.com/herdrdev/herdr/blob/HEAD/src/ui.rs#L158-L172).

For details, see [Layout Engine](09_2.4-layout-engine.md).

**Sources:** [src/ui.rs:111-120](https://github.com/herdrdev/herdr/blob/HEAD/src/ui.rs#L111-L120), [src/ui.rs:158-172](https://github.com/herdrdev/herdr/blob/HEAD/src/ui.rs#L158-L172), [src/app/state.rs:8-9](https://github.com/herdrdev/herdr/blob/HEAD/src/app/state.rs#L8-L9).

---

## Session Persistence and Handoff

Persistence is handled through two primary mechanisms:
1.  **Snapshots:** The `AppState` is serialized to `session.json` [src/app/mod.rs:139](https://github.com/herdrdev/herdr/blob/HEAD/src/app/mod.rs#L139). On restart, Herdr "rehydrates" the session, recreating the workspace/tab/pane hierarchy.
2.  **Live Handoff:** During a server upgrade or restart, Herdr can perform a zero-downtime handoff. This involves passing open PTY file descriptors from the old process to the new one using `SCM_RIGHTS` [src/server/headless.rs:78-96](https://github.com/herdrdev/herdr/blob/HEAD/src/server/headless.rs#L78-L96), allowing shell processes to remain alive and connected during the transition.

For details, see [Session Persistence and Handoff](10_2.5-session-persistence-and-handoff.md).

**Sources:** [src/app/mod.rs:139](https://github.com/herdrdev/herdr/blob/HEAD/src/app/mod.rs#L139), [src/server/headless.rs:78-96](https://github.com/herdrdev/herdr/blob/HEAD/src/server/headless.rs#L78-L96).