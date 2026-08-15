@intent
给 @deepseek-ai/dsh 上游的 issue 草案（中文正文 + 末尾英文版）：记录 dsh web 静默启动（父进程无控制台）时每次 agent 调用 shell/subprocess 工具都闪现 node 控制台窗口的 bug。含环境、现象、根因（dsh-subprocess-local 的 spawnSubprocess 缺 windowsHide/CREATE_NO_WINDOW）、建议修复代码与说明。供用户复制提交到 DSH 仓库；若 DSH 无公开仓库可转发支持渠道。

# DSH：Windows 上静默启动时每次 spawn 子进程都闪现控制台窗口 —— issue 草案

> 状态：**草案，未提交**。本文件是给 `@deepseek-ai/dsh` 上游的 issue 草稿（中文正文 + 末尾英文版），
> 你确认信息无误后，可复制到 DSH 的 GitHub 仓库提 issue。若 DSH 无公开仓库，也可作为反馈内容转发给支持渠道。
>
> 相关根因分析与最小修复落点见本仓库 README「已知问题与上游补丁」一节。

---

## 环境

- 平台：Windows（任一较新版本，Windows 10/11）
- 运行方式：由 VS Code 扩展 **以静默方式** 启动 `dsh web`（即父进程无控制台）
  - 扩展用 `node/child_process.spawn` 启服务，参数为 `windowsHide: true`、`stdio: ignore/pipe`、`detached`，
    因此 dsh web 服务进程**本身没有控制台**。
- DSH 版本：`@deepseek-ai/dsh`（npm 全局安装，`lib/` 为打包产物）

## 问题描述

在 DSH Web UI 里与 agent 对话时，**每次 agent 调用一个 shell / subprocess 工具**，Windows 任务栏/桌面都会
**闪现一个 node 控制台窗口**（标题/内容显示为 `node ...`，一闪而过，快到来不及看清完整命令行）。
agent 连续调用多个工具时，会反复多次弹窗，非常干扰。

## 根因分析

1. DSH 在 Windows 上把每条被隔离的命令包装成
   `[node, <di>/@deepseek-ai/dsh-sandbox-windows-acl/runner.js, <payload>]`，
   再交给 `@deepseek-ai/dsh-subprocess-local` 的 `spawnSubprocess()` 用 `node:child_process.spawn` 启动。
2. 该 spawn 调用**没有设置 `windowsHide`**（即没有使用 Windows `CREATE_NO_WINDOW` 标志）。
   - 项目内对该 spawn 全量检索，未发现任何 `windowsHide` / `CREATE_NO_WINDOW` 使用。
3. 关键场景组合：
   - dsh web 服务本身是被父进程**静默**启动（无控制台）时；
   - Windows 在创建子进程时，若父进程没有可继承的控制台，就会为这个**控制台类型的子进程**新建一个控制台窗口；
   - 于是每当 agent 触发一次 spawn，就弹出一个 node 窗口；命令结束/退出后窗口随之关闭 → 表现为"闪现"。

## 影响

- 用户体验：agent 对话期间反复弹窗，工作区被闪断干扰。
- 触发范围：所有在 Windows 上通过 DSH spawned 的 shell / subprocess 工具执行（pwsh、bash、subprocess 等），
  只要 DSH 服务是被无控制台方式启动的都会出现。

## 建议修复（供上游参考）

给 `dsh-subprocess-local` 的 `spawnSubprocess()` 里的 `spawn()` 增加窗口隐藏标志即可（不改执行模型、不剥离沙箱）：

```js
const child = spawn(program, args, {
    cwd: spec.cwd,
    env,
    stdio: [ /* 原样 */ ],
    detached: platform !== "win32",
    windowsHide: platform === "win32",   // 新增：win32 用 CREATE_NO_WINDOW，避免闪现控制台
});
```

要点：
- 仅 win32 置 `true`；非 win32 为 `false`，无副作用。该子进程的 stdout/stderr 本就是 pipe 交给收集器，
  用户并不需要那个独立控制台窗口。
- 这样既消除弹窗，也保留现有的 Windows ACL restricted-token 隔离沙箱。

## 备注

- 在下游修复合入前，本仓库投了 `scripts/patch-dsh-windows-hide.mjs` 作为可重复执行的最小补丁（DSH 升级后重打）。
- 如果上游选择在别处统一处理（例如封装一个带安全默认值的 spawn 辅助），本补丁即变为 no-op，可随时移除。

---

# English version (copy this if submitting on GitHub)

**Title**: Console window flashes on every tool subprocess spawn when `dsh web` is started silently on Windows

## Environment

- Platform: Windows 10/11
- Launch method: `dsh web` started **silently** by a VS Code extension launch wrapper
  (the server process itself has no console: `windowsHide: true`, `stdio: ignore/pipe`).
- DSH: `@deepseek-ai/dsh` (installed globally from npm, `lib/` is a build artifact).

## Problem

While chatting with an agent in the DSH Web UI, **every time the agent invokes a shell / subprocess tool**, a
`node` console window briefly flashes on the taskbar/desktop (shows `node ...`, closes almost immediately). With
several tool calls in a row, windows flash repeatedly and are quite disruptive.

## Root cause

1. On Windows DSH wraps each confined command as
   `[node, <dir>/@deepseek-ai/dsh-sandbox-windows-acl/runner.js, <payload>]` and launches it via
   `@deepseek-ai/dsh-subprocess-local`'s `spawnSubprocess()` using `node:child_process.spawn`.
2. That `spawn()` call does **not** set `windowsHide` (no `CREATE_NO_WINDOW`). A full search of the package found
   no `windowsHide` / `CREATE_NO_WINDOW` usage.
3. The key combination: when the dsh web server itself was started silently (no console), Windows creates a new
   console window for each console-type child, because the parent has no console to inherit. Each tool spawn
   therefore flashes a `node` window that closes when the command ends.

## Impact

All Windows tool subprocess executions spawned by DSH (pwsh / bash / subprocess) flash a window whenever the DSH
service is running without its own console.

## Suggested fix

Add a window-hide flag to the `spawn()` inside `spawnSubprocess()` (keeps the execution model and the Windows ACL
sandbox untouched):

```js
const child = spawn(program, args, {
    cwd: spec.cwd,
    env,
    stdio: [ /* unchanged */ ],
    detached: platform !== "win32",
    windowsHide: platform === "win32",   // CREATE_NO_WINDOW on win32; no-op elsewhere
});
```

Rationale: `true` only on win32 (no-op elsewhere); stdout/stderr are already piped to collectors, so the console
window serves no functional purpose for the user.

## Note

Until upstream is fixed, this repo ships `scripts/patch-dsh-windows-hide.mjs` as a rerunnable minimal patch.
Should upstream move the fix elsewhere, the patch becomes a no-op and can be dropped.
