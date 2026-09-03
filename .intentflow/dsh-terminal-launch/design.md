# 设计文档：DSH 终端启动可靠性（dsh-terminal-launch）

## 0. 与需求文档的偏差（设计阶段新发现）

- **偏差**：`onDidStartTerminalShell` 的位置与匹配方式需在设计阶段精确化。
  - **影响**：需求文档只说「等 shell 就绪」，未落 API 细节。实际该事件挂载在 `vscode.window` 上（`window.onDidStartTerminalShell`），回调参数是 `Terminal`；需靠对象引用（`e === terminal`）匹配，而不是在 `Terminal` 实例上订阅。测试 harness 需新增 `window.onDidStartTerminalShell` mock。
- **偏差**：`ensureReady` 里 `waitForPort` 超时路径有**两处**，且 terminal 复位要落在两处。
  - **影响**：需求「规则2」描述为单点复位；设计阶段确认主启动路径（switch 之后）与复用分支（`child || terminal`）各有一处超时，terminal 复位需覆盖两处，child 路径仍延后（见 later-on L01）。

## 1. 模块清单

已有项目，顺应原结构（`extension.js` 入口 → `src/manager.js` 编排 → `src/{detect,process,webview,patch}.js` 工具，`vscode` 由入口注入）。本次无新增模块、无新增文件，改动集中在编排层与对应单测：

- **manager**（`src/manager.js`）：编排层 — 职责：生命周期 open/stop/dispose、终端创建与命令下发、复用去重、失败复位。新增两个模块内私有 helper：`sendWhenShellReady` / `resetTerminal`。
  - 依赖：`deps.vscode`（注入）、`detect`、`process`、`webview`、`patch`（既有，方向不变）。
- **manager.test**（`test/manager.test.js`）：测试层 — 职责：编排决策与边界断言；harness 的 `vscode.window` 增补 `onDidStartTerminalShell` mock。
  - 依赖：`createManager`（注入假 detect/process/webview/patch/vscode）。

## 2. 最小依赖链

```
extension.js（入口，注册命令）
   └─ manager.open() / ensureReady()（编排：起服务 + 开页）
        ├─ detect.resolveConfig / resolveDsh / resolveWorkspace（纯函数，下）
        ├─ process.isPortInUse / httpProbe / waitForPort / buildTerminalCommand（端口与进程，下）
        ├─ vscode.window.createTerminal / onDidStartTerminalShell / sendText（系统边界，注入）
        └─ webview.buildWebviewHtml（下）
```

本次关键路径：`open → ensureReady → (integrated) createTerminal → show → sendWhenShellReady(terminal, cmd) → waitForPort → openWebview`；失败路径 `waitForPort=false → resetTerminal()`。

**跨层依赖体检**：`manager` 只依赖注入的 `vscode` 与底层工具，底层模块（detect/process/webview/patch）不依赖 manager、不依赖 vscode。无反向依赖，无跨层修复项。

## 3. 测试策略

- **验证方式**：
  - `sendWhenShellReady` / `resetTerminal` 为运行时行为（异步时序 + 状态复位）→ 需 node:test + 假 `onDidStartTerminalShell` 做时序断言。
  - `resetTerminal` 的「dispose + 置空」肉眼可读，但「下次 open 重建终端」需运行时行为验证。
- **依赖注入点**：`vscode` 已由 `createManager({ ..., vscode })` 注入；`detect/process/webview/patch` 已注入。新 helper 均通过注入的 `vscode` 访问 `window`，不在 manager 内部 `require('vscode')`。
- **验证命令**：
  - 全量单测：`node --test` — 预期：全绿，新增 3 个用例通过，既有用例不回归。
- **Mock 边界**：只 mock `vscode`（系统边界）与 `process`（外部服务/IO 适配，既有注入点）；不 mock manager 内部 helper。

新增用例（`test/manager.test.js`）：
1. `integrated sends command after shell ready` — 冷启动时序：断言 `sendText` 在 `onDidStartTerminalShell` 触发之后调用。
2. `integrated resets terminal when first start times out, then reopens` — 首次 `waitForPort=false` → `terminal.disposed===true`；再次 `open` 重建 terminal 且 `sent` 增加。
3. `integrated reusing a stuck terminal times out and resets it` — 复用分支：`terminal` 存在 + `waitForPort=false` → 复位 + 弹错。

## 4. 决策记录

- **决策**：integrated 创建终端后，用 `vscode.window.onDidStartTerminalShell`（匹配 `e === terminal`）等待 shell 就绪，超时 3000ms 兜底直接 `sendText`。
  - **理由**：解决「`createTerminal` 后立即 `sendText` 被 shell 吞掉」。对比过固定延时 hack（不可靠、受机器速度影响）与「发送失败后重开终端」（不能从根上减少失败）；等 shell 就绪 + 超时兜底是 VS Code 官方推荐且确定性强。
  - **影响**：engines `^1.106.0` 保证该 API 存在；harness 需模拟 window 级事件。
- **决策**：失败终端用 `dispose` 销毁并置 `terminal=null`（`resetTerminal`），下次重开新终端。
  - **理由**：死锁根因是「terminal 引用挂上后永不清理，复用分支永久复用一个已失败的终端」。关闭失败终端状态最干净，符合用户确认「关掉失败终端，下次重开」。
  - **影响**：`resetTerminal` 只在 `waitForPort` 超时路径调用；`onDidClose` 已有置空逻辑需与 `resetTerminal` 幂等（dispose 会触发 onDidClose，但重复置空无副作用）。
- **决策**：`sendWhenShellReady` / `resetTerminal` 作为 manager 模块内私有函数，不抽新模块。
  - **理由**：二者仅 manager 使用、且属于 manager 既有职责「屏蔽 VS Code 交互细节」；抽独立模块是过度设计。
  - **影响**：不新增文件，接口不对外暴露。
- **决策**：本次只做 terminal 侧复位，child 路径超时复位延后。
  - **理由**：用户命中路径是 integrated 终端；child（hidden/window/keepalive）是进程对象，生命周期与 terminal 不同，一并改动会扩大验证面。
  - **影响**：复用分支 `waitForPort` 超时时仅处理 `terminal` 存在的情况，`child` 保持现状。

## 5. 改动点清单（已有项目）

- 改 `src/manager.js`：
  - integrated 分支：`createTerminal` → `show()` → 经 `sendWhenShellReady(terminal, cmd)` 发送（替换现有直接 `sendText`）。
  - 新增内部 helper `sendWhenShellReady(terminal, cmd)`：订阅 `window.onDidStartTerminalShell`，`e === terminal` 则发送并解订阅；3000ms 超时兜底直接发送。
  - 新增内部 helper `resetTerminal()`：`terminal.dispose()` + `terminal=null`（幂等）。
  - 主启动路径 `waitForPort` 超时（switch 之后）：`integrated` 时调用 `resetTerminal()`。
  - 复用分支 `waitForPort` 超时：`terminal` 存在时调用 `resetTerminal()`。
- 改 `test/manager.test.js`：
  - harness `vscode.window` 增 `onDidStartTerminalShell` mock + terminal 触发 shell-ready 的能力。
  - 新增用例见「测试策略」3 条。
- 新增文件：无。