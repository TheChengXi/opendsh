# dsh-windows-console-window 关账报告

## 1. 项目概览
修复 DSH（@deepseek-ai/dsh）在 Windows 上静默启动 `dsh web` 时，agent 每次调用 shell/subprocess 工具都闪现 node 控制台窗口的问题。根因在 DSH 平台的 `spawnSubprocess()` 缺 `windowsHide`，与 opendsh 扩展无关；本 feature 以「可重复执行的幂等补丁脚本 + README/issue 文档 + release 发布」收尾，不改扩展运行时逻辑。

## 2. 计划 vs 实际
- ✅ 定位根因：DSH `dsh-subprocess-local` 的 `spawnSubprocess()` 里 `spawn()` 未设 `windowsHide`（CREATE_NO_WINDOW），dsh web 静默启动（无控制台）时 Windows 为每个控制台子进程新建窗口 → 闪现。
- ✅ 产出补丁脚本 `scripts/patch-dsh-windows-hide.mjs`（幂等、可重跑、--check/--dsh-root）并实际应用到 DSH 文件。
- ✅ 功能验证：补丁后 spawn 子进程正常输出/退出；`node --check` 语法通过；验证脚本幂等。
- ✅ README 新增「已知问题与上游补丁」一节（中英）。
- ✅ 上游 issue 草案 `docs/dsh-windows-console-window-issue.md`（中英）。
- ✅ report 要求的 @intent 标注补全（scripts/docs）。
- ✅ 变更文件带 @intent。
- ✅ release：version 0.0.3→0.0.4，新增 `package` 脚本，更新 `.vscodeignore`，打包 `opendsh-0.0.4.vsix`。
- 🟡 向 DSH 上游提交 issue：**未做**（草案已备，用户决定堤的地点和时机；DSH 为闭源 npm 包，提交目标仓库待用户确认）。
- 🟡 GitHub Release 上传：**待完成**——本地 vsix 与 tag 已备，但本机 `gh` token 无效，push/release 需用户认证后执行（见第 5 节）。

## 3. 关键决策
- 选方案 A「只隐藏窗口、保留后台执行」而非借用 VS Code 集成终端：命令本就后台 pipe 执行，独立窗口无功能作用；隐藏窗口不改执行模型、不剥离 Windows ACL 隔离沙箱，改动最小且可回退。用户拍板采用。
- 补丁脚本归入本仓库（`scripts/`）+ `docs/` 记录，而非直接手改第三方包后不复用；DSH 升级/重装会覆盖 node_modules，脚本保证一次性重打。
- `.vscodeignore` 排除 `docs/`、`scripts/`：运维/文档资产不进 vsix，扩展包只含运行时必要文件。
- issue 草案语言：中文正文 + 末尾英文版，便于用户审阅后直接复制到 GitHub。

## 4. 经验记录
- 有效做法：根因不是扩展自身，先通过「进程稳定运行 + pid 文件无变化」排除扩展反复 spawn 的假设；再全库 grep `windowsHide` 确认 DSH spawn 层完全缺失该标志，定位到单一统一出口 `spawnSubprocess()`（bash/pwsh/subprocess 工具全部收敛于此），实现一处打点全覆盖。
- 踩坑：往 DSH bundle 里手改时用脚本注入产生过「windowsHide 与 detached 挤同一行」的坏格式；改为「按 detached 行正则替换成两行」后干净幂等。教训：文本打补丁优先行级正则而非任意插入。
- 工具反馈：Windows 下绕 VS Code 内建 `$pid` 只读变量、PowerShell 内联 `-e` 引号转义易错——验证脚本应写成独立文件避免 shell 转义地狱。

## 5. 后续待办
- 立即跟进（本次未完成）：
  - 向 `@deepseek-ai/dsh` 上游提交 issue（草案在 `docs/dsh-windows-console-window-issue.md`）。
  - GitHub Release 上传：`gh auth login -h github.com`（或提供 PAT）后，`git push origin main` + 打 `v0.0.4` tag + `gh release create v0.0.4 opendsh-0.0.4.vsix`。
- 长期备忘：无独立 later-on.md；在 `.intentflow/_packages/opendsh.yml` 中登记 `docs/` 与 `scripts/` 资产，便于后续维护定位。

## 6. 开发工作流反馈
- report 流程本次从「修复已有 bug + 发布」任务出发，跨越了 execute→report，属于 bug 修复场景而非完整需求流；feature 命名与文件落位与常规 requirement/design 流程不同但适用。
- 建议：对「第三方依赖 bug 补丁」类任务，workflow 可增加一个「上游 issue 追踪」的小节模板（草案路径、提交目标、阻塞点），避免发布后忘记回流上游。
- 工具链瓶颈：`gh` token 无效、推送需 SSH key，release 的 push 步骤受本机认证状态阻塞，report 阶段无法静默完成发布闭环，需显式暴露给执行者。

## 7. 结论
- 当前状态：**可发布**（vsix 已打包、测试 70 通过、补丁/文档/issue 草案齐备）；GitHub Release 的 push/tag 上传凭证待用户认证后执行。
- 建议下一步：向 DSH 上游提交 issue；本机 `gh` 认证后完成 `v0.0.4` Release 上传；后续 DSH 升级若覆盖补丁，重跑 `node scripts/patch-dsh-windows-hide.mjs`；上游修复合入后移除补丁与本 feature。
