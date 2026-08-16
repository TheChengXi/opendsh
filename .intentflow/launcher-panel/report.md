# launcher-panel 关账报告

## 1. 项目概览
本 feature 始于「活动栏快捷启动面板」需求（内容区按钮 + 打开方式按钮 + globalState 状态记忆），
但在执行阶段被用户否决、全部回退。最终净结果：**把扩展回归薄壳启动器**——删除聚焦模式
（focus.js / openWith=focus / buildFocusUrls 的 ?focus= 契约）与活动栏面板，打开方式完全由
settings.openWith 三值（tab / simpleBrowser / systemBrowser）决定，不再承担任何界面聚焦契约。

## 2. 计划 vs 实际
- 活动栏面板（viewsContainers + WebviewView 按钮面板，6 按钮 postMessage 分发）：❌ 未做 — 方案被用户否决
- 内容区单区打开（openArea + ?focus= 契约）：❌ 未做 — 方案否决 + 聚焦契约回归 DSH 侧
- 打开方式 globalState 记忆（跨会话记住）：❌ 未做 — 回归纯 settings
- 移除聚焦模式（focus.js / openWith=focus / buildFocusUrls）：✅ 完成
- 回归薄壳启动器（open/stop 单入口，settings 驱动）：✅ 完成
- 保留 openWith 三值设置项（tab / simpleBrowser / systemBrowser）：✅ 完成（用户确认保留，仅去 focus）

## 3. 关键决策
- **决策**：活动栏面板方案整体否决，回归薄壳。
  - 理由：面板按钮"点击没反应"根因是 VS Code webview 里外部脚本被 CSP 静默拦截（nonce 方案混用，
    `script-src` 需用 `webview.cspSource` 放行 `asWebviewUri` 脚本）。用户判断在 VS Code 承载面下
    搞活动栏快捷面板得不偿失，宁可全部回归 settings。
  - 影响：panel.js / media/panel.js / viewsContainers 声明全部删除，opendsh 不再有活动栏视图。
- **决策**：?focus= 契约整体移除，回归 DSH 侧。
  - 理由：聚焦是另一个库（@dsh-focus/focus-plugin）的职责，opendsh 作为薄壳启动器不承担界面聚焦。
  - 影响：buildFocusUrls 删除，manager 不再有 openArea/openWith，webview 只加载 buildUrl 的裸地址。
- **决策**：execute 中途的 CSP 修复（nonce → cspSource）虽正确但不被采纳。
  - 理由：方案已整体否决，修复失去意义；该结论沉淀为本报告经验，供未来 DSH webview 类功能复用。
- **决策**：保留 openWith 设置项三值。
  - 理由：用户明确选择"保留 openWith 设置项，去掉面板和状态"。

## 4. 经验记录
- 有效做法：
  - VS Code webview 外部脚本必须用 `script-src ${webview.cspSource}` 放行（配合 `asWebviewUri`）；
    nonce 方案适用于内联脚本，与外部脚本混用会被静默拦截——现象是"按钮点了没反应"且 console 无报错。
  - 测试先行：execute 每步 node --test 全绿再继续；回退时测试同步收敛，75 测试循环 3 次全绿。
- 踩坑：
  - 活动栏 WebviewView 承载交互面板的链路长（viewsContainers 声明 → provider → CSP → postMessage），
    任一环出错都是"静默无反应"，真机排查成本高；单测（mock vscode）完全覆盖不到真实 webview CSP。
  - focus-layout 引入的 ?focus= 契约本应归 DSH 侧，opendsh 侧承担导致跨库职责不清——上一 feature
    边界没划清，本次整体清理。
- 工具反馈：
  - webview 运行时行为（CSP、脚本加载、postMessage）无法用 node --test 验证，需要真机/Edge headless。
    当前测试体系对"承载面 + 外部资源"类代码存在验证盲区。

## 5. 后续待办
- 立即跟进：无（薄壳已回归，opendsh-0.0.24.vsix 已打包，待用户安装验证）。
- 长期备忘：`.intentflow/launcher-panel/later-on.md`（D:\w_dev\openDSH\.intentflow\launcher-panel\later-on.md）
  的 L01-L04（面板高亮渲染、多区同屏、stop 按钮、按钮视觉区分）随方案否决作废；
  若未来重启活动栏面板方案，需先以 spike 验证 VS Code webview 承载可行再立项。

## 6. 开发工作流反馈
- 流程断点：requirement 阶段未识别"活动栏面板 = webview 承载 + 外部脚本 + CSP"的平台风险，
  design 阶段也未做最小 spike，直到 execute 阶段真机才暴露"点击没反应"。
  教训：**涉及承载面 + 外部资源的 feature，design 阶段必须强制最小 spike 验证平台能力**
  （focus-layout 已踩过"WebviewView 加载 http 白屏"，本次同类问题再次出现）。
- skill 建议：requirement/design skill 增加"承载面 + 外部资源"需求的 spike 门槛条目。
- 方案否决处置：feature 被否决时 report 流程正常执行、记录否决原因、净结果并入 yml——本次流程支持良好，
  无阻塞。

## 7. 结论
- 当前状态：**可发布**（0.0.24 vsix 已打包，75 测试全绿，薄壳回归完整）。
- 建议下一步：用户安装 opendsh-0.0.24.vsix，验证 openWith 三值按 settings 生效、活动栏无残留图标；
  "快捷打开不同区域"能力由 DSH 侧（focus-plugin 或用户其他库）承担，opendsh 不再扩展。
