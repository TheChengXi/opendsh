# 需求文档：DSH 终端启动可靠性（dsh-terminal-launch）

## 项目意图
修复 `opendsh.open` 在集成终端（`launch.mode=integrated`）模式下「服务未运行时点击后完全没反应、服务不起、页面不开」的启动死锁：启动命令必须可靠打进终端并拉起服务，失败后状态可复位、下次可重开，而不是永久卡死。

## 功能清单
1. **集成终端可靠下发启动命令**：创建 DSH 终端后等 shell 就绪再 `sendText`，避免命令被吞。
2. **启动失败可恢复**：命令下发后端口超时未就绪时，关闭失败终端并清引用，下次点击重开。
3. **服务已运行只开页不重复起**：端口已有 dsh 响应时直接打开页面，不新建终端、不重复发命令（现状回归锁定）。

## 核心功能

### 核心功能1：集成终端可靠下发启动命令
- **能力**：`opendsh.open` 在 `integrated` 模式且 dsh 服务未运行时，系统能够【创建 DSH 终端 → 等 shell 就绪 → 发送 `dsh web` 启动命令 → 等端口就绪 → 打开页面】，命令不因「终端 shell 未就绪」被吞。
- **业务价值**：一键拉起服务并打开页面，消除「点击后完全没反应」。

### 核心功能2：启动失败后可恢复
- **能力**：启动命令下发后若端口超时未就绪（命令被吞 / 执行失败），系统能够【关闭该失败终端、清除 `terminal` 引用】，使下一次点击重新走完整启动流程，而不是干等超时、永久复用已失败的终端。
- **业务价值**：失败自愈，用户再点一次即可恢复，无需手动清理卡死终端或重启窗口。

### 核心功能3：服务已运行只开页不重复起（回归约束）
- **能力**：`3080` 端口已有 dsh 响应（探测到 `__DSH_BOOT__`）时，`open` 直接打开页面，不新建终端、不重复发命令。
- **业务价值**：避免端口冲突 / 重复实例，保持既定「去重」语义不变。

## 业务规则

### 规则1：integrated 启动时序
- **场景**：端口未监听、无存活 child、无存活 terminal、有工作区、dsh 解析成功、`launchMode=integrated`。
- **行为**：`createTerminal('DSH')` → 等 shell 就绪（`onDidStartTerminalShell`，带超时兜底）→ `sendText(cmd)` → `show()` → `waitForPort`。
- **异常处理**：shell 就绪等待超时 → 仍 `sendText`（兜底），沿用现有「端口超时报错」路径。

### 规则2：启动超时后的 terminal 复位
- **场景**：integrated 模式启动后端口超时未就绪（`waitForPort` 返回 false）。
- **行为**：`dispose` 该终端、置 `terminal=null`、弹错提示；下一次 `open` 重新走规则1 完整启动。
- **异常处理**：终端已因 `onDidClose` 清理过 → 不再重复 dispose，仅保证 `terminal=null`。

### 规则3：复用分支不卡死
- **场景**：端口未监听，但 `terminal` 或 `child` 已存在（视为「正在启动」）。
- **行为**：`waitForPort` 等待；对 terminal 路径超时则按规则2 复位，不再把「已失败的启动实例」当作「正在启动」永久复用。
- **异常处理**：保持现有「spawn 失败报错」语义不变。

## 预设测试

### 前置条件
VS Code 打开工作区；`opendsh.launch.mode=integrated`（默认）；`3080` 端口空闲；dsh 已全局安装（或 `opendsh.dshPath` 已配置）。

### 测试步骤

1. **【核心功能1 正向】** 点击「打开 DSH」（标题栏大写 D 或状态栏 DSH）。
   **预期结果**：底部新建「DSH」终端，终端内出现 `dsh web` 启动命令（含 `--port 3080 --no-open`），服务拉起，DSH 标签页打开。

2. **【核心功能1 时序】** 冷启动（VS Code 刚开、终端 shell 尚未加载完）立即点击。
   **预期结果**：命令不丢失，服务照样拉起（不再出现「终端空白、无命令」）。

3. **【核心功能2 恢复】** 首次启动失败（模拟端口假占 / 命令执行失败）→ 弹错 → 失败的 DSH 终端被关闭 → 再次点击。
   **预期结果**：重新开一个干净终端、重新发命令、服务拉起、页面打开（不死等、不复用旧终端）。

4. **【核心功能3 回归】** 服务已运行（外部 `--no-open` 起 / autoStart 已起）。
   **预期结果**：不新建终端、不发命令，直接打开已有服务的页面。

### 异常场景

- **【无工作区】** 点击 → 弹错「open a workspace folder first」，不建终端、不开页。
- **【dsh 未找到】** 点击 → 弹错「dsh not found」，不建终端。
- **【端口被非 dsh 程序占用】** 点击 → 弹错「in use by another program」，不建终端、不开页。
- **【端口超时未就绪】** 点击 → 弹错「server did not start」并复位失败终端（规则2），下次可恢复。

## 边界收束

**此时必做**：
- integrated 创建终端后等 shell 就绪再 `sendText`（核心功能1）。
- 启动超时后 `dispose` 失败终端 + `terminal=null`，下次重开（核心功能2）。
- 上述两条的单元测试（harness 补 `onDidStartTerminalShell` 模拟 + 超时复位断言）。

**此时不做**：
- `child`（hidden / window / window-keepalive / hidden-keepalive）路径超时后的同类引用复位 — 非用户命中路径，且进程对象生命周期与终端不同；触发条件：确认这些模式也出现同类卡死时再纳入。
- 命令文本形态补齐（恒输出 `--host 127.0.0.1` / 强制 `node + bin.js` 而非 `dsh.cmd` shim）— 与「命令不输入」无关，`.cmd` shim 在终端可执行；触发条件：要求终端文本与手动输入完全一致时再改。
- 集成终端 `cwd` 显式设置 — 不影响本次 bug。

## 实现对齐

- **核心功能1**：改 `src/manager.js` integrated 分支，用 `vscode.window.onDidStartTerminalShell`（engines `^1.106.0` 可用）匹配 terminal 后发送；等不到用超时兜底直接发。— ✅ 明确（测试点：步骤2）
- **核心功能2**：`ensureReady` 在 `waitForPort` 失败路径，若 `terminal` 存在则 `dispose` + `terminal=null`（清「毒 terminal」），下次 `open` 重走 integrated。— ✅ 明确（测试点：步骤3）
- **核心功能3**：现状保留，现有测试 `open skips spawn when port in use` / `open opens when listening port is external dsh` 锁定，不新增改动。— ✅ 明确（测试点：步骤4）
- **推导出的约束1**：`sendText` 必须等 shell 就绪（`onDidStartTerminalShell`），避免命令被吞。— ✅ 已确认（用户选「关掉失败终端重开」，认可时序修复）
- **推导出的约束2**：失败终端用 `dispose` 关闭并置空引用。— ✅ 已确认（用户选「关掉失败终端，下次重开」）
- **design 决策1**：shell 就绪等待的超时时长（如 3000ms）取何值 — ⏸ 交由 design 阶段定，记录问题本身。
- **design 决策2**：复用分支同时覆盖 `child + terminal`，本次是否只修 terminal 侧 — 🎯 已定为「只修 terminal，child 延后」，记录歧义本身。
- **延后项**：`child` 超时复位、命令文本形态、终端 `cwd` — ⏸ 触发条件见「边界收束」。