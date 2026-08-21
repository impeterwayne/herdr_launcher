---
title: "A deep dive into Herdr"
description: "Herdr keeps coding agents in persistent terminal workspaces, shows which ones need attention, and exposes the whole system through a CLI and API."
author: "Flavio Copes"
date: "Aug 10, 2026"
source_url: "https://flaviocopes.com/herdr/"
tags:
  - AI
  - Herdr
  - Terminal
  - Coding Agents
  - Multiplexer
---

# A deep dive into Herdr

> **Original Source**: [https://flaviocopes.com/herdr/](https://flaviocopes.com/herdr/)
> **Author**: Flavio Copes | **Date**: Aug 10, 2026

Herdr keeps coding agents in persistent terminal workspaces, shows which ones need attention, and exposes the whole system through a CLI and API.
---
I run several coding agents every day.
One might be changing a website. Another is reviewing the change. A third is running tests in a different project. A fourth is waiting for an answer.
The agents are capable.
Keeping track of all their terminals is not.
[Herdr](https://herdr.dev) is a terminal workspace manager built for this exact problem.
It gives every agent a real terminal. It organizes those terminals into workspaces, tabs, and panes. A sidebar tells me which agent is working, blocked, done, or idle.
The session keeps running when I close the terminal. I can reconnect locally, over SSH, or from my phone.
And the whole system is scriptable.
Herdr has a CLI and a local socket API. A script can create a workspace, split a pane, start an agent, send it a prompt, wait for it, and read the result. An agent can do the same thing.
This is also how agents communicate through Herdr. A coordinator talks to the local Herdr server, targets another agent, sends a prompt, waits for its state to change, and reads its response.
This is the part that makes Herdr more than a nicer terminal multiplexer.
It is an interface for me, and a control plane for the agents.
If you used tmux, the shortest explanation is: **Herdr is tmux rebuilt around coding agents**.
If you never used a terminal multiplexer, that is fine. Herdr is mouse-native. You can start by clicking tabs, dragging pane borders, and using the right-click menus.
Let’s see how it works, why I find it compelling, and how it fits into my workflow.
## The problem Herdr solves
Running one coding agent is easy.
Open a terminal, start Codex or Claude Code, describe the task, and watch it work.
The workflow changes when you run several agents.
Now you need to remember:
  * which terminal belongs to which project
  * which agent is still working
  * which one needs approval
  * which one asked a question
  * which one finished while you were looking elsewhere
  * where the development server is running
  * where the test output went
  * what survives if you close the terminal or lose the SSH connection


Normal terminal tabs only solve the first part.
tmux and Zellij add persistent sessions, panes, and layouts. They are excellent general-purpose tools, but they do not understand the process inside a pane.
To tmux, Codex is just another command.
Graphical agent managers understand agent state, but they usually put the terminal inside their own application. That can mean a wrapped terminal, a desktop-only workflow, or a tool that does not follow me onto a remote Linux server.
Herdr sits between those two approaches.
It keeps the real terminal and persistent-session model. Then it adds agent awareness, mouse controls, remote access, notifications, and automation.
It is a single Rust binary. There is no account, hosted dashboard, Electron app, or telemetry.
The code keeps running where I started it.
Here is the practical comparison:  
| Capability  | Plain terminal tabs  | tmux or Zellij  | Graphical agent manager  | Herdr  |  
| --- | --- | --- | --- | --- |  
| Real terminal processes  | Yes  | Yes  | Depends on the app  | Yes  |  
| Persistent detach and reattach  | No  | Yes  | Usually different  | Yes  |  
| Panes and tabs  | Terminal-dependent  | Yes  | Yes  | Yes  |  
| Agent lifecycle state  | No  | No  | Yes  | Yes  |  
| Works through normal SSH  | Yes  | Yes  | Usually limited  | Yes  |  
| Mouse-native workspace UI  | Terminal-dependent  | Limited  | Yes  | Yes  |  
| Local CLI and socket API  | No shared layer  | General terminal control  | Product-dependent  | Yes, agent-aware  |  
| Agent can control another agent  | No  | Possible, but manual  | Product-dependent  | Built in  |  
Herdr is not automatically better in every row.
If I need one shell, I use one shell. If I need a battle-tested general multiplexer on a machine that already has tmux, tmux is enough. If I need product-level tasks, isolated environments, and a complete agent event history, a graphical agent platform may be the stronger abstraction.
Herdr becomes interesting when I want persistence, real terminals, agent awareness, and automation in one small layer.
## Herdr compared to cmux
Herdr is not strictly better than [cmux](https://cmux.com). It is a different layer.
cmux is the better Mac desktop terminal: native interface, vertical workspaces, notification rings, and a built-in scriptable browser.
Herdr is the better terminal-native multiplexer: server-owned persistent processes, semantic agent states, and the same interface on my Mac, a remote Linux server, or a small-screen terminal.
They can also work together. Herdr can run inside cmux, with cmux providing the Mac interface and browser while Herdr owns the persistent local or remote terminal session.
## The mental model
Herdr has five important concepts:

```mermaid
flowchart TD
  S["Session"] --> W1["Workspace: flaviocopes.com"]
  S --> W2["Workspace: product app"]
  W1 --> T1["Tab: agents"]
  W1 --> T2["Tab: dev server"]
  T1 --> P1["Pane: implementation agent"]
  T1 --> P2["Pane: reviewer agent"]
  P1 --> A1["Recognized agent"]
  P2 --> A2["Recognized agent"]
```

### A workspace is a project
A **workspace** is the top-level container.
I use one workspace per repository or focused investigation.
For example, `flaviocopes.com` can be one workspace and a Prototyped app can be another. Switching workspaces changes the entire project context instead of mixing unrelated terminals in one long tab bar.
A workspace owns its tabs and panes. It also rolls up the states of the agents inside it.
If an agent inside a background workspace needs a decision, the workspace shows that state in the sidebar.
### A tab is one view of the project
A **tab** is a layout inside a workspace.
I might have tabs called:
  * `agents`
  * `dev`
  * `tests`
  * `logs`
  * `review`


Each tab can contain one pane or a split layout.
Tabs let me keep related terminals together without showing all of them at once.
### A pane is a real terminal
A **pane** is a real terminal controlled by Herdr.
It can run a shell, an agent, a development server, a test watcher, `wrangler`, `ssh`, or any other terminal program.
Herdr renders the program’s actual terminal screen and sends input back to it. Full-screen terminal interfaces keep working because Herdr is not converting their output into chat messages.
Panes survive when the client detaches because the background Herdr server owns them.
### An agent is a recognized process inside a pane
A pane always exists as a terminal.
An **agent** exists when Herdr recognizes a coding-agent process inside that pane.
This distinction matters.
A test runner belongs to the pane layer. Codex belongs to both the pane and agent layers. Herdr can send raw input to either one, but only the agent layer understands lifecycle states such as `working` and `blocked`.
### A session owns the complete runtime
A **session** is a persistent Herdr server namespace.
The normal `herdr` command starts or attaches to the default session. Most people only need one session and several workspaces.
Named sessions are useful when you need completely separate runtime state:

```bash
herdr session attach work
herdr session attach experiments
```

Each named session gets its own workspaces, tabs, panes, processes, and socket.
My advice is to start with workspaces. Add named sessions only when you need a hard separation between two groups of work.
## The client and server architecture
The normal `herdr` command looks like one terminal application, but it starts two roles.

```mermaid
flowchart LR
  C1["Local terminal client"] --> S["Herdr background server"]
  C2["Second terminal client"] --> S
  C3["SSH or phone client"] --> S
  S --> P1["Pane PTY: Codex"]
  S --> P2["Pane PTY: dev server"]
  S --> P3["Pane PTY: tests"]
  S --> D["Saved session layout"]
```

The **server** owns the pseudo-terminals, child processes, live pane state, and session layout.
The **client** renders that state and sends keyboard or mouse input back to the server.
This is why closing a client does not stop the work. The process tree belongs to the server.
It also means several clients can attach to the same session. The server remains the single owner of the live terminal state.
## Install Herdr
Herdr publishes stable binaries for macOS and Linux. Windows support is currently available through the preview channel.
The direct installer is:

```bash
curl -fsSL https://herdr.dev/install.sh | sh
```

You can also use Homebrew:

```bash
brew install herdr
```

Or mise:

```bash
mise use -g herdr
```

Check the installation:

```bash
herdr --version
```

Generate shell completions if you use the CLI often.
For the current zsh session:

```bash
source <(herdr completion zsh)
```

Herdr can also generate completions for Bash, Fish, PowerShell, and Elvish.
Then start it inside a project:

```bash
cd ~/www/flaviocopes.com
herdr
```

The first run creates or attaches to the default background session. If the session has no workspace yet, Herdr creates one.
There is no socket setup to remember.
### Update Herdr
Installer-managed copies update with:

```bash
herdr update
```

Homebrew, mise, and Nix installations update through their package managers instead.
An updated client binary can sometimes connect to an older compatible server that is still running. Check both with:

```bash
herdr status
```

If the protocol requires a server restart, remember that stopping the server exits its pane processes. Finish important work first, or use the experimental live handoff path when the installed version supports it:

```bash
herdr update --handoff
```

## Your first five minutes
You can use Herdr with the mouse immediately.
Click a pane to focus it. Right-click to split it or create another tab. Drag the border between two panes to resize them. Click a workspace or agent in the sidebar to jump to it.
Herdr also has a tmux-style prefix key.
The default prefix is `ctrl+b`. Press the prefix, release it, then press the action key.
These are enough to get started:  
| Action  | Key  |  
| --- | --- |  
| Split right  |  `ctrl+b`, then `v`  |  
| Split down  |  `ctrl+b`, then `-`  |  
| New tab  |  `ctrl+b`, then `c`  |  
| Next tab  |  `ctrl+b`, then `n`  |  
| Previous tab  |  `ctrl+b`, then `p`  |  
| Workspace navigation  |  `ctrl+b`, then `w`  |  
| Zoom the focused pane  |  `ctrl+b`, then `z`  |  
| Detach  |  `ctrl+b`, then `q`  |  
| Show active bindings  |  `ctrl+b`, then `?`  |  
The prefix keeps Herdr from stealing normal keystrokes from the shell, editor, or agent.
Start an agent normally inside a pane:

```bash
codex
```

Herdr detects the foreground process. The agent appears in the sidebar, and its state changes as it works.
Detach with `ctrl+b q`. The terminal client closes, but the Herdr server, panes, agents, test watchers, and development servers keep running.
Reattach with:

```bash
herdr
```

You return to the same live processes.
## Agent state is the killer feature
Persistent panes are useful. The agent sidebar is what changes my workflow.
Herdr tracks five states:  
| State  | Meaning  |  
| --- | --- |  
| `working`  | The agent is actively working  |  
| `blocked`  | The agent needs input, approval, or a decision  |  
| `done`  | The agent finished in the background and I have not viewed it yet  |  
| `idle`  | The agent is ready and its tab has been seen  |  
| `unknown`  | Herdr sees an agent but cannot classify it confidently  |  
The states roll upward.

```mermaid
stateDiagram-v2
  [*] --> idle: agent detected
  idle --> working: prompt submitted
  working --> blocked: approval or answer needed
  blocked --> working: input received
  working --> done: finishes in background
  done --> idle: tab is viewed
  working --> idle: finishes while viewed
  idle --> unknown: state cannot be classified
  unknown --> working: known activity appears
```

`done` is not a separate condition reported by the agent. It is an attention state: the agent became ready while its tab was in the background. Once I view or focus it, it becomes `idle`.
A blocked agent marks its pane, tab, and workspace as blocked. A working agent makes the workspace active. A completed background agent stays visible as done until I look at it.
This removes terminal polling.
I do not need to open six tabs every few minutes to see whether an agent stopped. I look at one sidebar and go where my attention is needed.
### How detection works
Herdr first detects the foreground process in the pane.
For many agents, it then examines the live bottom of the terminal screen and matches known interface states. The project calls these rules **screen manifests**.
This works without configuring hooks.
Herdr can recognize Codex, Claude Code, Cursor Agent CLI, Pi, OpenCode, GitHub Copilot CLI, Devin, Kimi, Droid, and many other agents. Unsupported agents still run as normal terminal programs. They just do not get the richer lifecycle state automatically.
Some agents expose lifecycle hooks or plugins. For those, an official Herdr integration can report state directly.
Other integrations report the agent’s native session ID. Herdr can use that ID to resume the conversation after a full server restart.
Install the integrations for the agents you use:

```bash
herdr integration install codex
herdr integration install claude
herdr integration install cursor
herdr integration status
```

Codex and Claude Code still use screen detection for lifecycle state. Their integrations add native session identity for restore.
If a pane shows the wrong state, inspect the decision:

```bash
herdr agent explain reviewer
```

The output shows which detection source and rule produced the state.
## Persistence has three different meanings
The word “persistent” can hide important details.
Herdr separates three cases.

```mermaid
flowchart TD
  A{"What happened?"}
  A -->|"Client detached"| B["Server and processes stay alive"]
  A -->|"Server restarted"| C["Processes stop"]
  B --> D["Reattach to the exact live terminals"]
  C --> E["Restore workspace and pane layout"]
  E --> F{"Native agent session recorded?"}
  F -->|"Yes"| G["Resume supported agent conversation"]
  F -->|"No"| H["Open a new shell in the saved directory"]
```

### Detach and reattach
When you detach normally, the server keeps running.
Every process stays alive. This is real process persistence.
Close the terminal, reopen it, run `herdr`, and you return to the original shells and agents.
### Restart the Herdr server
If the Herdr server stops, its child processes stop too.
On the next start, Herdr restores the workspace, tab, pane, directory, layout, and focus structure. Normal panes come back as new shells.
The shape returns. The old processes do not.
Supported agent conversations can resume when an official integration previously reported their native session IDs.
That means Codex can restart with `codex resume <id>` instead of opening an empty shell, provided the integration was installed and current.
### Restore terminal history
Herdr can save recent pane contents across a server restart, but this is experimental and disabled by default.
That default is sensible.
Terminal output can contain prompts, source code, logs, API tokens, and secrets. Persisting the screen creates another sensitive file on disk.
Enable pane history only if you accept that tradeoff:

```toml
[experimental]
pane_history = true
```

Saved screen history restores what you can see. It does not restore the process that produced it.
## Remote work feels local
Herdr runs where the work lives.
The simplest remote setup is normal SSH:

```bash
ssh you@server
herdr
```

The Herdr server, agents, and shells all run on the remote machine. Detach, disconnect SSH, reconnect later, and attach to the same session.
This also works from a phone. Herdr adapts its interface to a narrow terminal, so I can check which agent needs me without installing a special mobile app.
There is another mode that starts from the local machine:

```bash
herdr --remote workbox
```

Or:

```bash
herdr --remote ssh://you@server:2222
```

In this mode, the local binary acts as a thin client for the remote Herdr server.
This keeps local desktop features available. For example, the local client can bridge an image from the local clipboard into a remote session.
For servers I visit often, I put the target in `~/.ssh/config` and use its short name.
If SSH is new to you, my [free SSH course](https://flaviocopes.com/courses/ssh/) covers host verification, keys, config, tunnels, automation, and troubleshooting.
## How I use Herdr
My Herdr configuration is deliberately boring.
I currently keep the default behavior and only disable onboarding after the first run:

```toml
onboarding = false
```

I prefer learning the defaults before customizing a terminal tool. The important part is the workspace structure, not a clever keymap.
Here is how Herdr fits into the work I already do.
### One workspace per active repository
I move between several repositories every day.
There is this site, the AI Workshop site, Prototyped, Factory Log, and the individual products I build and ship.
I give every active repository its own workspace.
Inside `flaviocopes.com`, I might use:

```text
workspace: flaviocopes.com
├── tab: agents
│   ├── pane: implementation agent
│   └── pane: review agent
├── tab: dev
│   └── pane: Astro development server
├── tab: checks
│   ├── pane: production build
│   └── pane: link or content audit
└── tab: deploy
    └── pane: Cloudflare Pages status and logs
```

This is not isolation by itself.
Every pane in that workspace can still point at the same working directory. Two agents editing the same file can conflict. Herdr organizes the work; it does not replace task boundaries, Git, reviews, or project instructions.
I avoid solving that with automatic worktrees in this project. I keep agents in the main working tree and give each one a narrow scope. One agent might edit a post while another checks unrelated metadata. Shared files and architecture stay under one coordinator.
The sidebar tells me when each agent finishes. Git still tells me what changed.
If Git is new to you, my [free Git course](https://flaviocopes.com/courses/git/) explains branches, diffs, commits, and the working tree. The [command line course](https://flaviocopes.com/courses/terminal/) covers the terminal foundations behind panes and persistent processes.
If coding agents are new to you, the [free AI Fundamentals course](https://flaviocopes.com/courses/ai-fundamentals/) covers agent loops, tools, permissions, and verification.
### Separate building from reviewing
I often split implementation and review.
One agent makes a focused change. Another reads the diff and looks for factual mistakes, broken links, missing surfaces, or tests that do not prove the behavior.
Herdr makes this visible:

```text
agents tab
├── builder     working
└── reviewer    idle
```

When the builder becomes done, I can prompt the reviewer. If the reviewer becomes blocked, I know the change needs a decision rather than more waiting.
This matches the workflow I described in my [deep dive into bb](https://flaviocopes.com/bb-agentic-ide/), but Herdr stays much closer to the terminal. It does not create its own task database or agent runtime. It organizes and controls the terminal processes I already use.
### Keep long-running processes beside the agents
Not every pane should contain an agent.
For an Astro project, I keep the development server in its own tab. Tests, build output, and deployment logs get their own panes.
The agent can work without owning the server process. I can restart the server, inspect its logs, or leave it running while I replace the agent.
This separation becomes useful when an agent finishes but the environment should stay alive.
I can close one agent pane without tearing down the development server and its logs.
### Keep several product repositories open without losing context
Prototyped means I often touch several small products in the same week.
Without a workspace layer, every terminal starts to look the same. The prompt shows a directory name, but I still have to scan it before typing.
Herdr gives each product a named workspace. Its tabs, panes, current directories, and agent states stay together.
I can leave a test suite running in one product, switch to another repository, then return without rebuilding the terminal layout.
The workspace is not only visual organization. It is a saved operational context.
### Detach instead of keeping a terminal window alive
Some tasks take a while: production builds, download generation, media processing, deployment monitoring, or a deep agent review.
I do not want the lifetime of that work tied to one terminal window.
Herdr lets me detach, close the window, and come back later. This is particularly useful on a remote server, where an SSH connection can disappear at any moment.
The process belongs to the Herdr server, not the client that happens to be looking at it.
### Check remote work from another device
I maintain applications and infrastructure on remote servers.
For that work, Herdr gives me the good part of tmux: I can start an operation over SSH, disconnect, and return to the same terminal later.
The agent awareness makes the return faster. I do not only recover the pane. I immediately see whether the remote agent is still working, waiting for approval, or done.
I can also attach from a smaller device for a quick check. I would not review a large diff on a phone, but I can answer a question, approve a safe command, or confirm that a deployment finished.
### Let an agent build the workspace
One fun use case is to let the agent create the terminal layout itself.
Shopify co-founder and CEO Tobi Lütke [shared his favorite Herdr demo](https://x.com/tobi/status/2086488457132626052): open a workspace, launch an agent, and tell it to read `herdr --skill` before splitting ten more panes into a sci-fi hacker terminal.
The sci-fi layout is playful, but it shows the core idea. Once the agent knows Herdr’s controls, it can create the panes it needs instead of asking me to arrange everything by hand.
## A complete practical workflow
Let’s put the pieces together with one concrete session.
I want to change a feature, keep the development server visible, and ask another agent to review the result.
### 1. Start in the repository

```bash
cd ~/www/project
herdr
```

Rename the workspace from the UI, or find its ID and rename it from another Herdr pane:

```bash
herdr workspace list
herdr workspace rename w1 project
```

The IDs in your session might differ. Always read them from the command response.
### 2. Create the working layout
I create an `agents` tab with two panes and a `dev` tab with one pane.
From the UI, this is a new tab, a vertical split, and another new tab.
From the CLI, the same structure starts with:

```bash
agents=$(herdr tab create \
  --workspace w1 \
  --cwd "$PWD" \
  --label agents \
  --no-focus)

builder_pane=$(printf '%s\n' "$agents" |
  jq -r '.result.root_pane.pane_id')

review=$(herdr pane split "$builder_pane" \
  --direction right \
  --cwd "$PWD" \
  --no-focus)

review_pane=$(printf '%s\n' "$review" |
  jq -r '.result.pane.pane_id')
```

Create the development tab:

```bash
dev=$(herdr tab create \
  --workspace w1 \
  --cwd "$PWD" \
  --label dev \
  --no-focus)

dev_pane=$(printf '%s\n' "$dev" |
  jq -r '.result.root_pane.pane_id')
```

### 3. Start the ordinary process
The development server is not an agent, so I use the pane surface:

```bash
herdr pane run "$dev_pane" "npm run dev"
```

I can read its output at any time:

```bash
herdr pane read "$dev_pane" \
  --source recent-unwrapped \
  --lines 80
```

### 4. Start the agents

```bash
herdr agent start builder \
  --kind codex \
  --pane "$builder_pane"

herdr agent start reviewer \
  --kind codex \
  --pane "$review_pane"
```

`agent start` needs an available shell pane. The shell must be at its prompt with no editor, server, or other foreground command running.
### 5. Give the builder a bounded task

```bash
herdr agent prompt builder \
  "Implement the requested change. Run the relevant tests and stop before committing." \
  --wait \
  --timeout 600000
```

The command returns when the agent reaches a settled `idle`, `done`, or `blocked` state.
If it returns blocked, I inspect the pane before replying:

```bash
herdr agent read builder \
  --source recent-unwrapped \
  --lines 120
```

### 6. Ask the reviewer to inspect the result

```bash
herdr agent prompt reviewer \
  "Review the current diff. Report only actionable findings with file and line references." \
  --wait \
  --timeout 600000
```

The review agent sees the same working tree in this example. It must remain read-only while reviewing, otherwise the ownership boundary becomes unclear.
### 7. Keep the final decision human
I read the diff, the build output, and the review findings.
Herdr made the terminals and state easy to coordinate. It did not decide whether the implementation was correct or whether the change should ship.
That boundary matters.

```mermaid
sequenceDiagram
  participant Me
  participant Herdr
  participant Builder
  participant Tests
  participant Reviewer
  Me->>Herdr: Create tabs and panes
  Herdr->>Tests: Run development server or test process
  Me->>Herdr: Prompt builder
  Herdr->>Builder: Submit task
  Builder-->>Herdr: working to done
  Me->>Herdr: Prompt reviewer
  Herdr->>Reviewer: Review current diff
  Reviewer-->>Herdr: blocked or done
  Herdr-->>Me: Sidebar state and terminal output
  Me->>Me: Inspect and decide
```

## Let one agent coordinate another
The CLI is where Herdr becomes an automation layer.
Herdr exposes three control surfaces:
  * layout commands create workspaces, tabs, and panes
  * pane commands control raw terminals and ordinary processes
  * agent commands control recognized agents and lifecycle state


Suppose a coordinator wants a second Codex agent to review a change.
First it splits the current pane:

```bash
split=$(herdr pane split --current \
  --direction right \
  --cwd "$PWD" \
  --no-focus)
```

Creation commands return JSON. Read the new pane ID from the response instead of guessing it:

```bash
review_pane=$(printf '%s\n' "$split" |
  jq -r '.result.pane.pane_id')
```

Start a named Codex agent in that pane:

```bash
herdr agent start reviewer \
  --kind codex \
  --pane "$review_pane"
```

Then send the task and wait for the agent to settle:

```bash
herdr agent prompt reviewer \
  "Review the current diff and report actionable findings." \
  --wait \
  --timeout 120000
```

Read the result:

```bash
herdr agent read reviewer \
  --source recent-unwrapped \
  --lines 120
```

The coordinator did not fake keystrokes and sleep for 30 seconds.
It created a terminal, started a known agent, prompted that exact agent, waited on lifecycle state, and read its terminal output.
This is a much stronger primitive.
The important automation rule is: **wait on meaning when Herdr has meaning**.
Use `agent wait` for an agent lifecycle. Use `pane wait-output` for a server or test command. Do not scrape agent text when Herdr already knows whether the agent is working or blocked.
### Pane commands are for ordinary processes
Use pane commands when the program is not an agent.
For example, run tests in a pane:

```bash
herdr pane run w1:p3 "npm test"
```

Wait for expected output:

```bash
herdr pane wait-output w1:p3 \
  --regex "passed|failed" \
  --timeout 120000
```

Then read the recent unwrapped output:

```bash
herdr pane read w1:p3 \
  --source recent-unwrapped \
  --lines 120
```

Use agent commands when lifecycle state matters:

```bash
herdr agent wait reviewer \
  --until blocked \
  --timeout 120000
```

That waits for an approval or question interface, not a text fragment that happens to contain the word “blocked”.
### The IDs are stable handles
Herdr gives workspaces, tabs, and panes public IDs:

```text
workspace: w1
tab:       w1:t1
pane:      w1:p2
```

Scripts should capture these values from JSON responses.
Agent names such as `reviewer` are convenient aliases for the live agent inside a pane. The name follows that agent and disappears when the process exits or is replaced.
This avoids a common automation bug: sending the next prompt to whatever terminal happens to be focused.
## Useful configuration
Herdr works without a custom config file.
When you do want to change it, the file is:

```text
~/.config/herdr/config.toml
```

Reload it without restarting the session:

```bash
herdr server reload-config
```

### Change the keybindings
The default keymap is prefix-first:

```toml
[keys]
prefix = "ctrl+b"
new_tab = "prefix+c"
next_tab = "prefix+n"
previous_tab = "prefix+p"
focus_pane_left = "prefix+h"
split_horizontal = "prefix+minus"
```

Press `ctrl+b ?` to see the bindings active in your session.
### Add notifications
Herdr can notify you when a background agent finishes or needs input:

```toml
[ui.toast]
delivery = "herdr"
delay_seconds = 1

[ui.toast.herdr]
position = "bottom-right"
```

The delivery can use an in-app toast, the outer terminal, the operating-system notification service, or be disabled.
Herdr suppresses the popup for the active tab. It alerts you about work you are not already watching.
### Customize the sidebar
The default agent row shows the state, workspace, tab, and agent name.
You can add status text or metadata reported by an integration:

```toml
[ui.sidebar.agents]
rows = [
  ["state_icon", "agent", "state_text"],
  ["workspace", "tab"],
]
```

Plugins and scripts can report custom tokens such as the model name or a short task summary.
That makes the sidebar a small live operations view rather than a list of anonymous terminals.
## Plugins and the socket API
The CLI is backed by a local socket API.
It can create and inspect layout, read panes, send input, control agents, subscribe to events, and wait for state changes.
Most automation should start with the CLI because it handles the socket details and returns structured JSON.
Use the raw API when you are building a long-running integration or need event subscriptions.
Herdr also supports plugins.
A plugin is an executable workflow package with a `herdr-plugin.toml` manifest. The implementation can be Bash, JavaScript, Lua, Rust, or anything else the machine can run.
There is no separate plugin SDK. Plugins use the same CLI and socket API.
This keeps the core focused on terminals and agents while allowing reusable workflows around them.
A plugin could:
  * create my preferred project layout
  * open a development server and test watcher
  * add a review agent beside the implementation agent
  * report a task summary in the sidebar
  * react when an agent becomes blocked or done
  * open a deployment dashboard in a popup


Plugins run local commands with the user’s permissions. Treat an installed plugin like any other executable code and inspect it before trusting it.
## Troubleshooting
Start every investigation with the installed version and the client/server state:

```bash
herdr -V
herdr status
```

Also note the outer terminal, operating system, local or remote mode, and whether tmux is wrapping Herdr or running inside one of its panes.
### Herdr does not detect the agent
Check the foreground process and the classification evidence:

```bash
herdr pane process-info --current
herdr agent explain <pane-or-agent>
```

If a shell framework automatically starts tmux inside the pane, Herdr sees tmux rather than the agent behind it. Run Herdr inside tmux as the outer multiplexer if needed, but do not put another tmux session between Herdr and the agent you want it to detect.
Check for detection manifest updates:

```bash
herdr server agent-manifests
herdr server update-agent-manifests
```

### The state looks wrong
Use:

```bash
herdr agent explain <target> --verbose
```

This shows the active manifest, matching rule, visible evidence, fallback reason, and remote update status.
An unknown state does not prove failure. An idle fallback does not always prove the agent finished. Read the pane before taking action.
### The binary updated but the session did not
The installed client may be newer than a compatible server that was already running.
Check `herdr status`.
To replace the server normally:

```bash
herdr server stop
herdr
```

Be careful: stopping the server exits its pane processes. Use live handoff when appropriate, or finish the work first.
### Remote attach cannot authenticate
Test normal SSH before debugging Herdr:

```bash
ssh workbox
```

If the SSH key has a passphrase, load it into `ssh-agent`. Once ordinary OpenSSH works, try:

```bash
herdr --remote workbox
```

### A keybinding does nothing
The operating system or outer terminal might consume the chord before Herdr sees it.
Open the help panel with `ctrl+b ?` and confirm the binding. Then check the terminal and desktop shortcuts.
Prefix bindings are the safest default. If you want direct shortcuts, the Herdr documentation recommends looking first at unused `ctrl+alt` combinations, while still checking conflicts on your operating system.
### A pane refreshes when I switch back to the terminal
By default, Herdr redraws the complete interface when the outer terminal regains focus. This helps repair stale terminal content, but some terminal emulators make the redraw look like a flash.
You can disable it in `~/.config/herdr/config.toml`:

```toml
[ui]
redraw_on_focus_gained = false
```

Then reload the configuration:

```bash
herdr server reload-config
```

The tradeoff is that a pane might occasionally show stale content until the next update.
### Find the logs
The default log files live under `~/.config/herdr/`:

```text
herdr.log
herdr-client.log
herdr-server.log
```

Enable more detail for a diagnostic run with:

```bash
HERDR_LOG=herdr=debug herdr
```

Logs can contain terminal and environment details. Inspect them before sharing them publicly.
## Command cheat sheet
Here are the commands I would keep nearby while learning Herdr:  
| Goal  | Command  |  
| --- | --- |  
| Start or reattach  | `herdr`  |  
| Check client and server  | `herdr status`  |  
| List workspaces  | `herdr workspace list`  |  
| Create a workspace  | `herdr workspace create --cwd ~/project --label project`  |  
| List tabs  | `herdr tab list --workspace w1`  |  
| Create a tab  | `herdr tab create --workspace w1 --label tests`  |  
| List panes  | `herdr pane list --workspace w1`  |  
| Split the current pane  | `herdr pane split --current --direction right`  |  
| Run a command  | `herdr pane run w1:p2 "npm test"`  |  
| Read pane output  | `herdr pane read w1:p2 --source recent-unwrapped --lines 120`  |  
| List agents  | `herdr agent list`  |  
| Start a named agent  | `herdr agent start reviewer --kind codex --pane w1:p2`  |  
| Prompt and wait  | `herdr agent prompt reviewer "Review the diff" --wait`  |  
| Wait for a question  | `herdr agent wait reviewer --until blocked`  |  
| Explain detection  | `herdr agent explain reviewer --verbose`  |  
| Install an integration  | `herdr integration install codex`  |  
| Reload config  | `herdr server reload-config`  |  
| Detach the UI  |  `ctrl+b`, then `q`  |  
Use explicit IDs or unique agent names in automation. Commands that act on the UI-focused pane are convenient for a person but fragile in a script.
## Where Herdr is a great fit
Herdr is compelling when your work already lives in terminals.
It fits especially well when:
  * you run more than one coding agent
  * you switch between several repositories
  * you want real terminal interfaces, not summarized transcripts
  * development servers and tests need to live beside agents
  * you work over SSH
  * you want processes to survive terminal disconnects
  * you want one agent or script to coordinate another
  * you use different agent products and want one shared view


It is also useful before you reach heavy automation.
Two agents and one long-running server are enough to make persistent workspaces and visible state valuable.
## Where Herdr is not the answer
Herdr does not solve every multi-agent problem.
### It does not isolate file changes
Two panes in the same directory can edit the same file.
Herdr can create worktrees, but using them safely is still a Git and project-architecture decision. I do not use them in every repository, and I do not let a terminal manager decide shared contracts for me.
Use clear task ownership, narrow scopes, branches when appropriate, and review.
### It does not provide shared memory
Herdr does provide a local communication path between agents. Agents and scripts talk to the Herdr server through its socket API. A coordinator can target another agent, send it a prompt, wait for it, and read its response.
This is orchestration, not shared memory. Herdr does not automatically merge agent context or project state.
Agents share project data through files, Git, and commands, like normal terminal processes. Agents in the same checkout see filesystem changes immediately, which also means they can conflict.
Agents in separate worktrees need an explicit handoff through commits, patches, or shared artifacts.
Herdr coordinates terminals, communication, prompts, and agent state. It does not synchronize project data for the agents.
### It does not replace an agent platform
Herdr does not store a product-level task graph, issue database, approval policy, or complete event history for every agent turn.
[bb](https://flaviocopes.com/bb-agentic-ide/) and [Buzz](https://flaviocopes.com/buzz/) operate at that higher application layer.
Herdr stays closer to the processes. That is a strength when I want a lightweight terminal-native tool. It is a limitation when I need a managed team workflow with durable tasks and organizational policy.
### Detection is not perfect
Screen-based detection depends on recognizable agent interfaces.
An agent update can introduce a new prompt shape. A wrapper can hide the foreground process. An unsupported agent may stay unknown.
Official integrations and remotely updated detection manifests improve this, but `unknown` still means exactly that. It does not mean success.
### A server restart is different from a detach
Detach keeps processes alive. Stopping the Herdr server does not.
The layout can return, and supported agent conversations can resume, but an arbitrary development server or test process must be started again.
Know which kind of persistence you are relying on.
### More agents still create more coordination
Herdr makes agent state visible. It does not make five overlapping tasks a good plan.
Parallel agents can produce incompatible changes, overload CI, and queue many deployments. I have already seen a burst of parallel pushes [block a Cloudflare Pages build queue](https://flaviocopes.com/fix-stuck-cloudflare-pages-build-queue/).
The dashboard reduces the attention cost. It does not remove the need for one clear plan and a review step.
## Why I find Herdr compelling
Herdr does not ask me to replace the tools I already use.
Codex stays Codex. Claude Code stays Claude Code. The shell stays a shell. Astro, tests, Git, SSH, and deployment tools keep running as normal processes.
Herdr adds the missing layer around them.
It gives the terminals structure. It gives agents visible state. It gives long-running work persistence. It gives people a mouse and keyboard interface. It gives scripts and agents a CLI and API.
Most importantly, those are all views of the same live system.
I can start an agent by hand, let Herdr recognize it, then address it from a script. An agent can create a reviewer in another pane. I can watch both in the sidebar, detach, and reconnect later over SSH.
There is no export step between the human interface and the automation interface.
That is the same property I liked in bb: the environment is not only where I watch agents. It is something agents can operate.
Herdr reaches that idea with a much smaller abstraction.
Workspaces, tabs, panes, processes, state, and a socket.
For the way I work today, that is a very compelling foundation.
I also wrote [a deep dive into cmux](https://flaviocopes.com/cmux/) and a direct [Herdr vs cmux comparison](https://flaviocopes.com/herdr-vs-cmux/).
Start with the [Herdr quick start](https://herdr.dev/docs/quick-start/), then read the [agent guide](https://herdr.dev/docs/agents/) and [agent automation guide](https://herdr.dev/docs/agent-automation/).
Tagged: [AI](https://flaviocopes.com/tags/ai/) · [All topics](https://flaviocopes.com/blog/#topics)
