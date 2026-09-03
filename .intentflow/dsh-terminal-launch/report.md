# dsh-terminal-launch 关账报告

## 1. 项目概览
修复 `opendsh.open` 在服务未运行时「点击后没反应 / 起不来 / 永久卡死」的启动死锁，让启动命令可靠拉起 dsh web 服务、失败后状态可复位可重开，并顺带解决 Windows 下 `dsh.cmd` shim 弹命令行黑框的问题。

## 2. 计划 vs 实际
- ✅ 集成终端可靠下发命令 — 完成，但方案与计划不同（见「关键决策」）：最终恢复为 `createTerminal → show → sendText`，未用 `onDidStartTerminalShell`。
- ✅ 启动失败后 terminal 复位（`resetTerminal`）— 完成，覆盖主启动 + 复用两处 `waitForPort` 超时。
- ✅ 服务已运行只开页不重复起 — 现状回归锁定，未改。
- 🔸 child 启动失败复位（`resetChild`）— 计划「延后」（later-on L01），实际执行中发现用户真实命中路径就是 hidden 死锁，改为必做并落地。
- 🔸 dsh 定位改 `node + bin.js` 并删 `.cmd` 兜底 — 计划「延后」（later-on L02），实际因弹窗 bug 必做。
- ❌ `onDidStartTerminalShell` 等 shell 就绪 — 计划做，实际删除（VS Code 1.135 无该 API + 属误诊）。

## 3. 关键决策
- 推翻 `onDidStartTerminalShell` 方案：用户 VS Code 1.135.0 报 `is not a function`；且需求假设「sendText 被 shell 吞」是误诊——真正根因是 `launch.mode=hidden` 配置 + 毒 child 死锁，与 terminal 时序无关。故删 `sendWhenShellReady`，integrated 恢复最简单的 `createTerminal → show → sendText`。
- child 复位由延后改必做：日志里 37 连击 `reusing (no duplicate spawn)` 证明毒 child 引用是真实死锁点，补 `resetChild`（kill 僵尸 + 清引用 + 删 pid）。
- 删 PATH `.cmd` shim 兜底：用户明确「别兜底」，且 `.cmd` 经 cmd.exe 会弹黑框（nodejs/node#21825）。`resolveDsh` 改为单一路径：Windows 只用 npm 全局真实入口（`node + bin.js`），找不到直接 null 报 `dsh not found`。

## 4. 经验记录
- 有效做法：读 exthost 日志（`output_logging_.../DSH.log`）定位 37 连击复用死锁；直接在本机跑 `resolveNpmGlobal({})` 验证产物就是预期的 `node + bin.js`；联网搜索确认 `.cmd` 弹窗是 Windows API 行为（nodejs/node#21825）而非本扩展逻辑 bug。
- 踩坑：假设 VS Code 高版本必有 `onDidStartTerminalShell`（1.135 也没有）；`Reload Window` 对已激活扩展模块缓存不彻底，改完需彻底退出 VS Code 重开才生效；初始诊断被用户 settings（hidden 模式）误导，把「配置错误 + 毒引用」误判成「terminal sendText 时序」。
- 工具反馈：无。

## 5. 后续待办
- 立即跟进：无（用户已确认 integrated 可用，将继续其他 feature）。
- 长期备忘：later-on.md（`D:\w_dev\openDSH\.intentflow\dsh-terminal-launch\later-on.md`）的 L01、L02 已在本次落地并标记；仍延后 L03（terminal cwd）、L04（更细粒度 shell 就绪判定）。

## 6. 开发工作流反馈
- requirement 阶段未等日志证据就锁定根因假设（「终端里命令没输入」→ 臆断 sendText 被吞），导致 design 沿错误方向设计 `onDidStartTerminalShell`。建议：涉及「不生效 / 卡死」类问题，requirement 先要求提供 exthost 日志再定根因。
- 「延后项」判定过轻：L01（child 复位）、L02（命令形态）先后被证明正是要修的东西。判断「用户不会命中某路径」应基于日志证据，而非症状字面。

## 7. 结论
- 当前状态：可发布（106 单测全绿，用户确认 integrated 终端可用、不再弹命令行黑框）。
- 建议下一步：本 feature 收尾；后续 feature 从零走 requirement 流程，L03 / L04 留待触发条件出现时再实现。