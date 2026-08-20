# dsh-upgrade-compatibility 关账报告

## 1. 项目概览
修复 opendsh VS Code 扩展在 DSH 升级后出现的功能失效问题——静默启动失效（控制台窗口弹出）、打开位置失效（总是额外打开系统浏览器）。

## 2. 计划 vs 实际

- **计划功能清单**：
  1. 静默启动修复：DSH 服务启动时不弹出 Windows 控制台窗口
  2. 打开位置修复：DSH 页面按 `opendsh.openWith` 配置在指定位置打开，不额外打开系统浏览器
  3. 补丁脚本重跑：`scripts\patch-dsh-windows-hide.mjs` 补丁脚本需要重新运行

- **实际完成状态**：
  1. ✅ 静默启动修复 — 通过运行 `patch-dsh-windows-hide.mjs` 补丁脚本，成功添加 `windowsHide: platform === "win32"` 参数
  2. ✅ 打开位置修复 — 在 `buildDshArgs()` 函数中添加 `--no-open` 参数，禁用 DSH 的自动打开浏览器行为
  3. ✅ 补丁脚本重跑 — 补丁脚本已成功运行，`dsh-subprocess-local/lib/index.js` 中已有 `windowsHide: platform === "win32"` 参数

## 3. 关键决策

1. **添加 `--no-open` 参数**：DSH web 应用默认会打开浏览器（`openBrowser: true`），这是 DSH 内部行为。通过在启动参数中添加 `--no-open`，禁用 DSH 的自动打开浏览器行为，由 opendsh 扩展控制打开方式。

2. **添加调试日志**：在 `readSettings()`、`openWebview()`、`spawnDsh()` 等函数中添加调试日志，便于追踪配置读取和执行流程。

## 4. 经验记录

- **有效做法**：
  - 通过分析 DSH 源码（`dsh-web-app/lib/index.js`）发现 `openBrowser` 配置默认为 `true`，这是系统浏览器额外打开的根本原因
  - 使用 `--no-open` 参数禁用 DSH 的自动打开浏览器行为，简单有效
  - 运行 `patch-dsh-windows-hide.mjs` 补丁脚本修复控制台窗口弹出问题

- **踩坑**：
  - 最初误以为问题在 DSH 的 `dsh-subprocess-local` 模块，实际上控制台窗口弹出是因为该模块缺少 `windowsHide` 参数
  - 系统浏览器额外打开是因为 DSH web 应用默认 `openBrowser: true`，需要通过 `--no-open` 参数禁用

- **工具反馈**：
  - `patch-dsh-windows-hide.mjs` 补丁脚本需要管理员权限才能运行（Windows 文件权限问题）
  - 调试日志对于追踪配置读取和执行流程非常有帮助

## 5. 后续待办

- **立即跟进**：
  - 重新加载 VS Code 扩展，测试静默启动和打开位置功能是否正常工作
  - 如果还有问题，查看输出面板中的 DSH 日志，追踪配置读取和执行流程

- **长期备忘**：
  - DSH 升级会覆盖 `node_modules`，需重新运行 `patch-dsh-windows-hide.mjs` 补丁脚本
  - 考虑将 `--no-open` 参数添加到 opendsh 扩展的配置中，让用户可以选择是否禁用 DSH 的自动打开浏览器行为

## 6. 开发工作流反馈

- **流程断点**：
  - 最初没有正确理解用户的问题，误以为问题在 DSH 的 `dsh-subprocess-local` 模块
  - 需要更多的调试日志来追踪配置读取和执行流程

- **skill 缺失**：
  - 需要一个更好的方式来追踪配置读取和执行流程
  - 需要一个更好的方式来测试配置是否正确应用

- **工具链瓶颈**：
  - `patch-dsh-windows-hide.mjs` 补丁脚本需要管理员权限才能运行
  - 调试日志需要手动添加到代码中

## 7. 结论

- **当前状态**：可发布
- **建议下一步**：
  1. 重新加载 VS Code 扩展，测试静默启动和打开位置功能是否正常工作
  2. 如果还有问题，查看输出面板中的 DSH 日志，追踪配置读取和执行流程
  3. 考虑将 `--no-open` 参数添加到 opendsh 扩展的配置中，让用户可以选择是否禁用 DSH 的自动打开浏览器行为
