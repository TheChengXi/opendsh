# Open DSH · 打开 DSH

> 在 VS Code 里一键打开 DeepSeek Harness 的 Web UI —— 零依赖、零硬编码的薄壳启动器。
> A tiny, zero-dependency VS Code extension that opens the DeepSeek Harness Web UI inside VS Code.

[中文](#中文) · [English](#english)

---

<a id="中文"></a>
# 中文

**Open DSH** 是一个极简的 VS Code 扩展：编辑器标题栏（标签栏同层）的大写 D 按钮与底部状态栏的
「DSH」按钮都可一键打开 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)
（`dsh`）的 Web UI——单击直接执行 `DSH: Open DSH`，在编辑器内以**单标签页**打开
（重复点击只聚焦已有标签页，不会越开越多；webview 不可用时回退系统浏览器），
并能为当前工作区自动启动 / 停止 `dsh web` 服务。


## 功能

- **标题栏快捷按钮** —— 编辑器标签栏同层右上角的大写 D 按钮，单击直接执行 `DSH: Open DSH`
  （打开 / 聚焦唯一的 DSH 标签页）。
- **状态栏快捷按钮** —— 底部状态栏左侧的「DSH」按钮，同样单击直接执行 `DSH: Open DSH`；
  常驻显示，即使没有任何打开的标签页也能一键启动。
- **启动自动打开（默认开启）** —— 由设置 `opendsh.autoStart`（默认 `true`）控制：VS Code 启动时
  自动启动 dsh 服务并打开 DSH 标签页，重载 / 重启后标签页自动恢复；设为 `false` 则仅按需打开。
- **打开方式三选一（可选）** —— 设置 `opendsh.openWith`（默认 `"tab"`）：
  - `"tab"`：内置单例标签页（默认，重复打开只聚焦不新建）
  - `"simpleBrowser"`：VS Code 内置 Simple Browser（每次打开新建标签页）
  - `"systemBrowser"`：系统浏览器直接浏览 `http://host:port`（保留地址栏 / DevTools / 扩展等完整浏览器能力）
- **多标签页（可选）** —— 设置 `opendsh.multipleTabs`（默认 `false`）为 `true` 时，`"tab"` 方式下每次打开都
  新建独立 DSH 标签页（所有标签页共享同一个 dsh 服务端口），适合对照查看；所有打开操作带 300ms 防连点节流，
  避免误触多开。
- `DSH: Open DSH` —— 打开 Web UI：如果当前工作区的服务没在运行，会先自动启动（自动识别工作区目录、
  `.dsh/*.patch.yml` 补丁文件、`dsh` 可执行文件）；端口已在监听则直接打开。
- **单标签页复用** —— DSH 以唯一标签页展示（自定义 webview 承载），重复打开只聚焦、不新建；
  关闭标签页不影响后台服务，服务仍由 `DSH: Stop DSH` / 关闭 VS Code 管理。
- `DSH: Stop DSH` —— 停止由本扩展启动的服务。
- 深链 `vscode://TheChengXi.opendsh/open` —— 从 VS Code 外部打开 UI（同样的自动启动逻辑）。

## 环境要求

- Node.js（用于运行 `dsh` CLI）。
- 全局安装 `dsh`：`npm i -g @deepseek-ai/dsh`，或设置 `opendsh.dshPath`。
  两者都找不到时，扩展立即报错并提示安装或配置。

## 设置

- `opendsh.host`（默认 `127.0.0.1`）—— DSH web 服务绑定的主机。
- `opendsh.port`（默认 `3080`）—— DSH web 服务监听的端口。
- `opendsh.dshPath`（默认 `""`）—— `dsh` 的路径；留空表示自动（先 npm 全局安装，后 PATH）。
- `opendsh.patchFile`（默认 `""`）—— MCP 补丁文件；留空表示自动发现工作区根目录下的
  `.dsh/*.patch.yml`。
- `opendsh.launch.mode`（默认 `"integrated"`）—— 启动方式（输出载体 × 是否随 VS Code 存活）五选一：
  - `integrated`：在 VS Code 集成终端运行，随 VS Code 关闭而停止（默认）。
  - `window`：在桌面控制台窗口运行，随 VS Code 关闭而停止。
  - `hidden`：静默启动（日志在 Output 面板 DSH 频道），随 VS Code 关闭而停止。
  - `window-keepalive`：在桌面控制台窗口运行，VS Code 关闭后**继续运行**（关窗或 Stop 才停）。
  - `hidden-keepalive`：静默启动，VS Code 关闭后继续运行。
  启动模式在启动那一刻固定：**切换后需先 `Stop DSH`（或关窗/关端）再重新 `Open DSH` 才生效**。
- `opendsh.experimental.windowsHidePatch`（默认 `false`）—— 实验功能：仅当 `launch.mode = "hidden-keepalive"` 时，
  通过集成终端一次性修补 DSH 源码（`windowsHide`）以抑制工具调用闪窗；会修改已安装源码，存在风险。
- `opendsh.autoStart`（默认 `true`）—— VS Code 启动时是否自动启动 dsh 服务并打开 DSH 标签页；
  `false` 时仅按需打开。
- `opendsh.openWith`（默认 `"tab"`）—— 打开方式：`"tab"`（内置单例标签页）/ `"simpleBrowser"`（VS Code 内置
  Simple Browser，每次新建标签页）/ `"systemBrowser"`（系统浏览器直开 `http://host:port`）。
- `opendsh.multipleTabs`（默认 `false`）—— 是否允许多个 DSH 标签页并存（仅对 `openWith = "tab"` 生效）；
  `true` 时每次打开新建标签页，所有标签页共享同一服务端口。

## 安装

用 `npx @vscode/vsce package` 打包出 `.vsix` 后安装；或把本目录复制到扩展目录下，命名为
`TheChengXi.opendsh-0.1.1`，然后重载窗口。

## 测试

```
node --test
```

从终端打开：`start "" "vscode://TheChengXi.opendsh/open"`（Windows）或
`open "vscode://TheChengXi.opendsh/open"`（macOS）。

---

<a id="english"></a>
# English

**Open DSH** is a tiny VS Code extension: a capital-"D" button on the editor title bar
(same row as the tabs) and a "DSH" button on the status bar both run `DSH: Open DSH` with
one click, opening the [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)
(`dsh`) Web UI in a **single reusable editor tab** (re-clicking focuses the existing tab
instead of stacking more; falls back to your system browser if the webview is unavailable),
and can start / stop the `dsh web` server for the current workspace.

## Features

- **Title-bar quick button** — a capital-"D" button at the right end of the editor tab row;
  one click runs `DSH: Open DSH` (opens / focuses the single DSH tab).
- **Status-bar quick button** — a "DSH" button at the left of the status bar; one click runs
  `DSH: Open DSH` too. It is always visible, so you can launch DSH even with no tabs open.
- **Auto-start on launch (default on)** — controlled by the `opendsh.autoStart` setting
  (default `true`): VS Code starts the dsh server and opens the DSH tab automatically, so the
  tab comes back after a reload / restart. Set it to `false` to open on demand only.
- **Open-with options (optional)** — the `opendsh.openWith` setting (default `"tab"`) chooses
  how the DSH UI opens:
  - `"tab"`: built-in single reusable tab (default; re-opening focuses it, never stacks).
  - `"simpleBrowser"`: VS Code's built-in Simple Browser (one new tab per open).
  - `"systemBrowser"`: your system browser at `http://host:port` (full browser capabilities:
    address bar, devtools, extensions).
- **Multiple tabs (optional)** — set `opendsh.multipleTabs` (default `false`) to `true` to have
  every open create a separate DSH tab in `"tab"` mode (all tabs share the same dsh server on
  one port), handy for side-by-side views. All open actions are throttled (300ms) to avoid
  accidental duplicates from rapid clicks.
- `DSH: Open DSH` — open the Web UI; if the server isn't running for the current workspace,
  it auto-starts it first (auto-detecting the workspace folder, its `.dsh/*.patch.yml` files,
  and the `dsh` executable). If the port is already listening, it just opens.
- **Single reusable tab** — the DSH UI lives in one tab (custom webview); re-opening focuses
  it instead of creating new tabs. Closing the tab does not stop the server; it stays managed
  by `DSH: Stop DSH` / closing VS Code.
- `DSH: Stop DSH` — stop the server this extension started.
- Deep link `vscode://TheChengXi.opendsh/open` opens the UI from outside VS Code (same
  auto-start behavior).

## Prerequisites

- Node.js (to run the `dsh` CLI).
- `dsh` installed globally: `npm i -g @deepseek-ai/dsh`, or set `opendsh.dshPath`.
  If neither is found, the extension fails fast with a clear error.

## Settings

- `opendsh.host` (default `127.0.0.1`) — host the DSH web server binds to.
- `opendsh.port` (default `3080`) — port the DSH web server listens on.
- `opendsh.dshPath` (default `""`) — path to `dsh`; empty means auto (npm global install, then PATH).
- `opendsh.patchFile` (default `""`) — MCP patch file; empty means auto-discover
  `.dsh/*.patch.yml` in the workspace root.
- `opendsh.launch.mode` (default `"integrated"`) — how to launch (output carrier × whether it
  survives VS Code), one of:
  - `integrated`: in a VS Code integrated terminal; stops when VS Code closes (default).
  - `window`: in a desktop console window; stops when VS Code closes.
  - `hidden`: silent, logs in the Output panel "DSH" channel; stops when VS Code closes.
  - `window-keepalive`: in a desktop console window; **keeps running** after VS Code closes.
  - `hidden-keepalive`: silent; keeps running after VS Code closes.
  The launch mode is fixed at start time: after changing it, `Stop DSH` first, then `Open DSH`.
- `opendsh.experimental.windowsHidePatch` (default `false`) — experimental: only when
  `launch.mode = "hidden-keepalive"`, patch the DSH source (`windowsHide`) once via the integrated
  terminal to stop tool-call windows from flashing; modifies the installed source, at your own risk.
- `opendsh.autoStart` (default `true`) — whether VS Code auto-starts the dsh server and opens
  the DSH tab on startup; `false` opens on demand only.
- `opendsh.openWith` (default `"tab"`) — how to open the DSH UI: `"tab"` (built-in single
  reusable tab), `"simpleBrowser"` (VS Code's built-in Simple Browser, a new tab per open),
  `"systemBrowser"` (system browser at `http://host:port`).
- `opendsh.multipleTabs` (default `false`) — allow multiple DSH tabs (only when
  `opendsh.openWith` is `"tab"`); `true` opens a new tab per open, all sharing one server port.

## Install

Build a `.vsix` with `npx @vscode/vsce package`, then install it; or copy this folder into
your extensions directory as `TheChengXi.opendsh-0.1.1` and reload the window.

## Test

```
node --test
```

To open from a terminal: `start "" "vscode://TheChengXi.opendsh/open"` (Windows) or
`open "vscode://TheChengXi.opendsh/open"` (macOS).

---

## 已知问题与上游补丁 · Known issue & upstream patch

### 问题 / Issue

在 Windows 上以静默模式（`launch.mode = "hidden"` 或 `"hidden-keepalive"`）启动 `dsh web` 后，与 agent 对话时
**每次调用 shell / subprocess 工具，任务栏都会闪现一个 node 控制台窗口**（一闪而过，快到来不及看清）。
反复调用工具时反复弹窗。

根因 **不在本扩展**：DSH（`@deepseek-ai/dsh`）在 Windows 上把每条隔离命令包装成
`[node, .../dsh-sandbox-windows-acl/runner.js, <payload>]`，再经 `dsh-subprocess-local` 的
`spawnSubprocess()` 用 `node:child_process.spawn` 启动，但**该 spawn 未设 `windowsHide`
（`CREATE_NO_WINDOW`）**。由于 dsh web 本身是被本扩展静默启动（无控制台），Windows 没有可继承的控制台，
就为每个控制台类型的子进程新建一个控制台窗口 → 闪现后随命令退出关闭。

### 临时补丁 / Local patch

仓库内置可重复执行的幂等补丁 `scripts/patch-dsh-windows-hide.mjs`：给 `spawnSubprocess()` 的 `spawn()`
补一行 `windowsHide: platform === "win32"`（不改执行模型、不剥离 Windows ACL 隔离沙箱）。仅 win32 生效，
非 win32 无副作用；stdout/stderr 本就 pipe 回收到对话，用户并不需要独立控制台。
扩展也内置了同一补丁逻辑（`src/patch.js`）：当 `launch.mode = "hidden-keepalive"` 且开启
`experimental.windowsHidePatch` 时，扩展会在集成终端自动执行补丁命令（幂等，已打则跳过）。

```bash
node scripts/patch-dsh-windows-hide.mjs           # 应用补丁（幂等）
node scripts/patch-dsh-windows-hide.mjs --check   # 只检查是否已打过
```

- 打补丁后需**重启 DSH 服务生效**（VS Code 里 `Stop DSH` 再 `Open DSH`）。
- DSH 升级 / 重装会覆盖 `node_modules`，届时重跑一次本脚本即可。
- 上游（`@deepseek-ai/dsh`）修复合入后，本补丁将变为 no-op，可随时移除；
  待提给上游的 issue 内容见 `docs/dsh-windows-console-window-issue.md`。

### Status

On Windows, when `dsh web` runs **silently** (`launch.mode = "hidden"` or `"hidden-keepalive"`), every
shell / subprocess tool call flashes a `node` console window in the taskbar while you chat with an agent.
The root cause is **not this extension**: DSH wraps each confined command as
`[node, .../dsh-sandbox-windows-acl/runner.js, <payload>]` and spawns it via `dsh-subprocess-local`'s
`spawnSubprocess()` without `windowsHide` (`CREATE_NO_WINDOW`). With the server started silently (no console
to inherit), Windows creates a fresh console window per console-type child, which flashes and closes on exit.

This repo ships a rerunnable, idempotent patch `scripts/patch-dsh-windows-hide.mjs` that adds
`windowsHide: platform === "win32"` to that `spawn()` (keeps the execution model and the Windows ACL sandbox
intact; no-op on non-Windows). Restart DSH after applying. Re-run the script after a DSH upgrade / reinstall.
Once upstream (`@deepseek-ai/dsh`) fixes it, the patch becomes a no-op and can be removed; see
`docs/dsh-windows-console-window-issue.md` for the issue draft.
