# 结构设计：聚焦模式三区布局（focus-layout）

## 0. 与需求文档的偏差（设计阶段新发现）

- **偏差**：需求"输入区放底部面板"——设计验证发现现状输入区是 **WebviewPanel**（`createWebviewPanel` 编程创建，主编辑区标签页），而底部面板容器必须用 **WebviewView**（`registerWebviewViewProvider` + `contributes.views` 声明挂到 panel 容器）— **影响**：focus.js 不再创建任何 WebviewPanel，全部四个承载面统一为 WebviewView；输入区承载方式从"编程创建"变为"声明式视图"，focus.js 结构随之重构（无 createWebviewPanel 分支）。
- **偏差**：需求"保留活动栏消息流视图"——设计验证该视图 URL 需从旧值 `?focus=conversation` 改为新值 `?focus=conversation.session`（旧值在强化后插件中显示"对话区整体含输入区"，新值才是纯消息流）— **影响**：契约升级覆盖全部视图，不止新增的。
- **偏差**：webview.js 的 cache-buster 已支持 query 拼接（`url.includes('?') ? '&' : '?'`）— **影响**：`?focus=conversation.session` 等带 query 的 URL 自动走 `&t=<ts>` 分支，**webview.js 零改动**。
- **偏差**：容器展开命令——`workbench.view.extension.<id>` 对 auxiliary bar 容器的支持已由 [PR #170137](https://github.com/microsoft/vscode/pull/170137) 合入，panel 容器同理 — **影响**：open 时用统一命令展开三个容器；容器是我们自己声明的，打开命令必然存在（开发环境无"命令缺失"分支），直接执行不捕获异常。
- **偏差**：四视图同源（同 host:port）→ 共享 localStorage（`dsh.sessions.current`）→ **会话选择自动联动**，点任一视图的会话，其余视图跟随 — **影响**：三区会话互通比需求预期更强，无需任何桥接或联动代码。
- **偏差**：VS Code 1.133.0 实机诊断（extension-editing schema 校验）暴露三个声明事实——① `viewsContainers` 的属性名是 **`secondarySidebar`** 而非 `auxiliarybar`（后者从未进入稳定版 schema；`auxiliarybar` 是 2025-01 某分支 commit 的命名，main 分支实际用 `secondarySidebar`，2025-08~10 合入（首次 #261619，定稿 10-27），1.106.0 起可用）；② `viewsContainers` 的容器 id 必须匹配 `^[a-zA-Z0-9_-]+$`（**不允许点号**），而 `views` 的视图 id 无此限制；③ `contributes.views` 的 item **icon 必填**（`required: ['id', 'name', 'icon']`）— **影响**：声明位改用 `secondarySidebar`；容器 id 用连字符（`opendsh-focus-conversation` / `opendsh-focus-input`）；四视图补 `icon`；`engines.vscode` 升 `^1.106.0`（1.98 时 secondarySidebar 尚不存在）。
- **偏差**：实机验证（用户反馈"容器展开但 Webview 不渲染"）暴露声明关键缺口——`contributes.views` 的 item **默认类型是 `tree`**（`ViewType` 枚举 `tree`/`webview`，缺省 tree），WebviewView 必须显式 `"type": "webview"`；否则 VS Code 按 TreeView 处理（期望 `registerTreeDataProviderForView`），`registerWebviewViewProvider` 的 `resolveWebviewView` **永不调用**，容器照常展开但视图内容空白 — **影响**：四视图声明补 `"type": "webview"`；此缺口自双承载面时代（`opendsh.dsh-chat`）即存在，因当时未在 VS Code 内实机验证侧栏视图而未暴露。

## 1. 模块清单

- **[extension.js]**：上层 — 激活入口，`createFocus({detect, webview, vscode})` 注入 manager；无业务逻辑改动 — 依赖：[manager]
- **[src/manager.js]**：中间层 — 生命周期编排，openWith=focus 委托 `focus.open`、stop/dispose 调 `focus.reset`；**接口不变，零改动** — 依赖：[detect, process, webview, focus]
- **[src/focus.js]**：中间层 — 多承载面编排：承载面描述表（VIEW_SPECS）驱动注册/复用/清理四个 WebviewView provider；open 注册 + 展开容器，resolve 写入对应聚焦 URL，reset 清引用 — 依赖：[detect, webview, vscode]
- **[src/detect.js]**：下层 — `buildFocusUrls` 输出三值 `{ sessions, conversation, composer }`；纯函数 — 依赖：无
- **[src/webview.js]**：下层 — iframe 壳 html 生成；**零改动**（已支持 query 拼接）— 依赖：无
- **[package.json]**：声明层 — `viewsContainers`（activitybar + secondarySidebar + panel 三容器）、`views`（四视图）、`engines.vscode` 升 `^1.106.0` — 依赖：无

## 2. 最小依赖链

```
extension.js → manager.js → focus.js → detect.buildFocusUrls（三值）
                                   └→ webview.buildWebviewHtml（不改）
                                   └→ vscode（系统边界：registerWebviewViewProvider / executeCommand）
```

**跨层依赖体检**：extension → manager → focus → {detect, webview, vscode}，全部上层→下层单向。focus 依赖 detect/webview（下层纯函数）与 vscode（系统边界，最底层），无反向依赖。**本次无跨层依赖，无需修复项。**

## 3. 测试策略

- **验证方式**：
  - detect.js：纯函数 — 断言可验证，无需运行时
  - focus.js：多承载面编排 — 需 mock vscode 系统边界验证注册/复用/清理行为（沿用现有 harness 思路扩展）
  - manager.js：接口不变 — 现有测试即可，仅确认 focus 委托不回归
- **依赖注入点**：focus.js 由 [构造器参数] 注入 { detect, webview, vscode }（现状保持，不内部创建）；test 注入 fake detect / fake vscode
- **验证命令**：`npm test`（node --test）— 预期：全绿（现 79 用例 × 3 稳定性保持）
- **Mock 边界**：只 mock vscode（系统边界）与 fake detect；webview 用真实模块（内部协作者不 mock，现状模式）

## 4. 决策记录

- **决策**：focus.js 用承载面描述表（VIEW_SPECS 数组）驱动四视图注册，而非手写四个 provider 工厂
  - **理由**：四视图行为同构（注册→resolve 写 URL→复用），表驱动消灭重复；对比备选"每视图独立函数"——视图数量会随插件侧演进（list occupant 聚焦等）增长，表驱动扩展成本最低
  - **影响**：新增视图 = VIEW_SPECS 加一行 + package.json 加声明；getState/reset 遍历表
- **决策**：视图 id 命名——容器 `opendsh`（现有）/ `opendsh-focus-conversation` / `opendsh-focus-input`（连字符，viewsContainers id 不允许点号）；视图 `opendsh.dsh-sessions` / `opendsh.dsh-chat`（保留）/ `opendsh.dsh-conversation` / `opendsh.dsh-input`（视图 id 无点号限制）
  - **理由**：`opendsh.` 前缀与现有 `opendsh.dsh-chat` 一致；视图 id 全局唯一（VS Code 约束），辅助侧边栏消息流必须新 id 不能复用 dsh-chat
  - **影响**：`FOCUS_INPUT_PANEL_ID` 废弃（无 panel 了），新增 `FOCUS_SESSIONS_VIEW_ID` / `FOCUS_CONVERSATION_VIEW_ID` / `FOCUS_INPUT_VIEW_ID` 常量
- **决策**：容器展开命令直接执行，不捕获异常（无容错分支）
  - **理由**：容器在 package.json 由我们自己声明，VS Code 必然注册其打开命令——"命令缺失"分支在开发环境不存在，不需要防御（AGENTS.md Unperfect Code Is Perfect：不存在的分支不写）；真失败即抛错暴露，优于静默吞掉
  - **影响**：open 时三容器必然尝试展开；本次重构同步移除现状 `revealSideView` 的 try/catch 静默容错（历史遗留，不属于本次需求但随重构清理）
- **决策**：provider 注册常驻不注销，reset 只清状态引用
  - **理由**：视图声明在 package.json，provider 必须常驻才能响应 VS Code 的 resolve 调用；现状 reset 也不注销 provider（registerWebviewViewProvider 返回的 Disposable 未保存，扩展卸载时才回收）
  - **影响**：reset 后再次 open 只重写 URL 缓存与展开容器，不重复注册
- **决策**：四视图全部复用 `webview.buildWebviewHtml`（不改）
  - **理由**：壳已支持 query 拼接 cache-buster 与健康探测，四视图通用；对比"为聚焦视图定制壳"——无必要性，统一壳减少分支

## 5. 改动点清单

改动（现有文件）：
1. `src/detect.js` — `buildFocusUrls` 输出三值：`sessions` → `/?focus=sidebar`、`conversation` → `/?focus=conversation.session`、`composer` → `/?focus=conversation.composer`
2. `src/focus.js` — 重构为 VIEW_SPECS 表驱动多承载面编排：四视图注册/复用/容器展开/reset；删除 createWebviewPanel 分支与 FOCUS_INPUT_PANEL_ID；新增三视图 id 常量
3. `package.json` — `viewsContainers` 增 secondarySidebar（`opendsh-focus-conversation`）与 panel（`opendsh-focus-input`）容器；`views` 增 `opendsh.dsh-sessions`（activitybar）、`opendsh.dsh-conversation`（secondarySidebar）、`opendsh.dsh-input`（panel）三视图（均带 icon，views schema 必填），保留 `opendsh.dsh-chat`；`engines.vscode` → `^1.106.0`
4. `test/detect.test.js` — `buildFocusUrls` 断言更新为三值
5. `test/focus.test.js` — 重写：四 provider 注册/复用、容器命令展开、resolve 写 URL、reset 清状态（无 panel 断言）
6. `README.md` — openWith=focus 描述更新（三区布局；可选，report 阶段统一）

新增文件：无（顺应原有结构，不新增模块文件）
