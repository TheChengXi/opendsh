# dsh-upgrade-compatibility 关账报告（第二迭代）

## 1. 项目概览
让 opendsh 的 open/stop 命令对 dsh 本体升级鲁棒——dsh 升级后手动 Stop/Open 直接可用，不再需要改源码、重新编译、重装扩展。

## 2. 计划 vs 实际
- ✅ resolveDsh 去 `lib/bin.js` 硬编码：改为 `dshPath > PATH shim > npm 全局（读 package.json bin）`，并删除失效的 npm prefix 探测。
- ✅ buildDshArgs 收敛为最小稳定参数集（web / --patch 可选 / --host 非默认才传 / --port / --no-open），单测锁死。
- ✅ stop→open「刚停残留」判定：stop 打点 lastStopAt，ensureReady 残窗内等待端口释放、超时报错，修掉端口误判竞态。
- ❌ 日志/诊断增强：requirement 曾列为核心功能 3，用户明确「没必要做日志」，从范围移除。

## 3. 关键决策
- **resolveNpmGlobal 精简为「仅 Windows APPDATA + 读 package.json bin」**：比 design 预期的「修复 npm prefix 注入」更进一步——直接删除 runNpmPrefix/cachedNpmPrefix，POSIX 交由 PATH 的 dsh 可执行脚本覆盖。与 design 方向一致（去硬编码、按 bin 字段），实现更精简，同时消除了「resolveDsh 未传 deps」的隐性 bug。
- **waitForPortRelease 落在 process.js**：design 只说「等待端口释放的确定性判定」，落点由 execute 定为 process 能力层（与 waitForPort 对称），不纳入 manager，保持分层干净。

## 4. 经验记录
- 有效做法：先用 git log（c0ae911 / 7512336）定位历史契约断点，再读 dsh 本体的 bin.js / startup.js 确认当前 CLI 两层结构，把「脆弱耦合」从猜测升为三重证据（git + 历史文档 + 代码），比盲改参数高效得多。
- 踩坑：「重编译重装=好使」其实是 autoStart 冷启动兜底掩盖了手动链路问题——排障时不能只看结果「好使」，要分清是哪条路径好使。
- 工具反馈：沙箱下 `node --test` 默认按进程隔离会 spawn 子进程（stdio pipe）触发 `spawn EPERM`，需 `node --test --test-isolation=none`；与代码无关但会误导「测试全挂」。

## 5. 后续待办
- 立即跟进：真实 VS Code 里实测一次 dsh 升级后手动 Stop→Open，验证竞态修复端到端效果；重新加载/重装扩展使本次改动生效。
- 长期备忘：见 `D:\w_dev\openDSH\.intentflow\dsh-upgrade-compatibility\later-on.md`（L01 日志体系 / L02 契约探测 / L03 版本感知 / L04 转义风险回退）。

## 6. 开发工作流反馈
- 流程断点：requirement 阶段把「手动无反应机制」标 ⏸ 待运行时验证，最终靠 design 阶段从「autoStart 冷启动 vs 手动热切换」推演出竞态根因，而非运行时日志——纯静态分析能收敛，但需在 design 阶段主动归因「为什么同源却表现不同」。
- skill 缺失：无（requirement→design→execute→report 链路跑通）。
- 工具链瓶颈：node --test 的 process isolation 与沙箱冲突，建议在项目文档/脚本固化 `--test-isolation=none`。

## 7. 结论
- 当前状态：可发布（102 测试全绿，稳定循环 3 次通过）。
- 建议下一步：真实 VS Code 端到端验证一次 dsh 升级场景后发布；后续 dsh 升级以 `node --test --test-isolation=none` 全绿作为契约未破的判据。