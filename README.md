# Open DSH · 打开 DSH

> 在 VS Code 里一键打开 DeepSeek Harness 的 Web UI —— 零依赖、零硬编码的薄壳启动器。
> A tiny, zero-dependency VS Code extension that opens the DeepSeek Harness Web UI inside VS Code.

[中文](#中文) · [English](#english)

---

<a id="中文"></a>
# 中文

**Open DSH** 是一个极简的 VS Code 扩展：它在 VS Code 内置的 Simple Browser 里打开
[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（`dsh`）的 Web UI
（打不开时回退到系统浏览器），并能为当前工作区自动启动 / 停止 `dsh web` 服务。

它不是 DSH 的重新实现，也不耦合 DSH 的内部 API —— 它只做一件事：**把官方已经写好的
Web 客户端，原样搬进编辑器里**。因此它自动继承 Web UI 的全部能力（client 插件、slot、
主题、GenUI 内联渲染等），同时几乎不承担 DSH 版本演进带来的维护成本。

## 功能

- `DSH: Open DSH` —— 打开 Web UI；如果当前工作区的服务没在运行，会先自动启动（自动识别
  工作区目录、`.dsh/*.patch.yml` 补丁文件、`dsh` 可执行文件）。如果端口已在监听，直接打开。
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
- `opendsh.detached`（默认 `false`）—— 服务是否独立于编辑器存活；`false` 时关闭 VS Code 随之一同停止，
  `true` 时（Windows）经 WMI 在 VS Code 进程树之外启动，关闭 VS Code 后服务真正继续运行（配合
  `showWindow` 可带独立控制台窗口）。启动模式在启动那一刻固定：**切换此配置后需先 `Stop DSH`（或关窗）
  再重新 `Open DSH` 才生效**。
- `opendsh.showWindow`（默认 `false`）—— 是否弹出控制台窗口显示服务地址；`false` 时静默启动（日志在
  Output 面板 DSH 频道），`true` 时弹出窗口，关闭窗口即停止服务。

## 安装

用 `npx @vscode/vsce package` 打包出 `.vsix` 后安装；或把本目录复制到扩展目录下，命名为
`TheChengXi.opendsh-0.0.1`，然后重载窗口。

## 测试

```
node --test
```

从终端打开：`start "" "vscode://TheChengXi.opendsh/open"`（Windows）或
`open "vscode://TheChengXi.opendsh/open"`（macOS）。

---

<a id="english"></a>
# English

**Open DSH** is a tiny VS Code extension that opens the
[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`) Web UI inside
VS Code's built-in Simple Browser (falling back to your system browser), and can start /
stop the `dsh web` server for the current workspace.

It is not a reimplementation of DSH, and it does not couple to DSH's internal APIs — it does
one thing only: **bring the official Web client into your editor, as-is**. So it inherits the
full power of the Web UI (client plugins, slots, themes, GenUI inline rendering, …) while
carrying almost none of the maintenance cost that comes with DSH version changes.

## Features

- `DSH: Open DSH` — open the Web UI; if the server isn't running for the current workspace,
  it auto-starts it first (auto-detecting the workspace folder, its `.dsh/*.patch.yml` files,
  and the `dsh` executable). If the port is already listening, it just opens.
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

## Install

Build a `.vsix` with `npx @vscode/vsce package`, then install it; or copy this folder into
your extensions directory as `TheChengXi.opendsh-0.0.1` and reload the window.

## Test

```
node --test
```

To open from a terminal: `start "" "vscode://TheChengXi.opendsh/open"` (Windows) or
`open "vscode://TheChengXi.opendsh/open"` (macOS).
