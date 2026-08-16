# 需求文档：聚焦模式三区布局（focus-layout）

## 项目意图
opendsh 聚焦模式升级为"三区隔离"布局：会话选择区进主侧边栏（活动栏容器）、消息对话区进右侧辅助侧边栏（secondarySidebar）、输入区进底部面板（panel），主编辑区完全留给代码。利用 @dsh-focus/focus-plugin 已开放的三值聚焦 URL（`?focus=sidebar` / `?focus=conversation.session` / `?focus=conversation.composer`），AI 对话彻底移出主视野，同时保留现有活动栏消息流视图。

## 功能清单
1. **[URL 契约升级]**：`detect.buildFocusUrls` 从旧值（`?focus=conversation` / `?focus=composer`，已与强化后的插件脱节）升级为新三值，输出 `sessions` / `conversation` / `composer` 三个同源聚焦 URL
2. **[承载面声明]**：package.json contributes 声明三个视图容器——`activitybar`（会话选择区视图 + 保留现有消息流视图）、`secondarySidebar`（消息流视图，新）、`panel`（输入区视图，新）；engines 升 `^1.106.0`
3. **[承载面编排]**：focus.js 升级为多承载面编排——open 注册/复用全部视图与容器并写入对应聚焦 URL，reset 清引用
4. **[三区会话互通]**：四个视图共享同一 dsh 端口与会话，消息实时同步（DSH 网页互通原生能力，无需自研桥接）

## 核心功能

### 核心功能1：URL 契约升级
- **能力**：系统能够把聚焦 URL 契约对齐到插件强化后的三值——`detect.buildFocusUrls(host, port)` 返回 `{ sessions, conversation, composer }`，分别为 `?focus=sidebar`（会话选择区）、`?focus=conversation.session`（消息流）、`?focus=conversation.composer`（输入区）
- **业务价值**：三个承载面各自只显示对应功能区；消除当前旧契约导致的"输入区页面显示完整 DSH 界面"失效问题

### 核心功能2：三承载面声明
- **能力**：系统能够在 VS Code 原生承载三区——`activitybar` 容器（主侧边栏）放会话选择区 + 保留现有消息流视图；`secondarySidebar` 容器（右侧辅助侧边栏）放消息流视图；`panel` 容器（底部面板）放输入区视图；engines 升 `^1.106.0` 保证 secondarySidebar 可用
- **业务价值**：主编辑区完全留给代码，AI 对话分布在左/右/下三个非编辑区，最贴合"主视野是代码而非 AI 对话"

### 核心功能3：承载面编排
- **能力**：系统能够在 open 时注册/复用全部视图容器并写入对应聚焦 URL，stop/dispose 时清引用——focus.js 由双承载面（侧栏 chat + 主区 panel）升级为多承载面编排
- **业务价值**：一键打开三区就位，重复打开只聚焦不重复注册，关闭视图不影响服务进程

## 业务规则

### 视图懒启动
- **场景**：容器常驻活动栏（无 when 限制）；用户触发 open（openWith=focus 时展开三容器）或手动展开容器触发视图 resolve
- **行为**：各 WebviewViewProvider 仅注册一次；resolve 时把最新聚焦 URL 写入对应 webview 的 iframe
- **异常处理**：视图/容器创建或注册抛错时按现状回退 `openExternal`，不静默创建残缺承载面

### 三区会话互通
- **场景**：四个视图同时打开（活动栏会话列表 + 活动栏消息流 + 辅助侧边栏消息流 + 底部输入区）
- **行为**：全部指向同一 `http://host:port` 的不同 `?focus=` 页面，共享同一 DSH 会话，任一页发消息其余页实时同步
- **异常处理**：DSH 无活跃会话时由插件侧 `autoResumeSession` 自动恢复最近非空白会话

### 生命周期
- **场景**：stop 命令 / VS Code 关闭（deactivate→dispose）
- **行为**：`focus.reset()` 清全部承载面引用；视图/面板被用户关闭时仅清对应引用
- **异常处理**：reset 不触碰 dsh 服务进程（服务生命周期仍归 manager）

## 预设测试

> 从用户视角可执行的测试步骤，验证功能是否符合预期。

### 前置条件
- VS Code ≥ 1.106（secondarySidebar 可用）
- dsh web 服务运行中（或由 opendsh 自动启动），focus 插件已挂载（patch insert `@dsh-focus/focus-plugin`）
- 设置 `opendsh.openWith = 'focus'`（若 dsh 跑在非默认端口，同时配置 `opendsh.port`）

### 测试步骤

1. **打开聚焦模式**：点击标题栏 D 按钮（或命令 `DSH: Open DSH`）
   **预期结果**：主侧边栏 DSH 活动栏容器出现"会话列表 + 消息流"两个视图；右侧辅助侧边栏出现消息流视图；底部面板出现输入区视图；主编辑区无 DSH 页面
2. **三区会话互通**：在底部输入区输入并发送一条消息
   **预期结果**：主侧边栏消息流与右侧辅助侧边栏消息流同时出现该消息（实时同步）
3. **重复打开**：再次执行 open
   **预期结果**：不重复注册视图，已有承载面被聚焦/展开
4. **关闭重建**：关闭底部输入区视图后再次 open
   **预期结果**：输入区视图重建并显示
5. **停止服务**：执行 `DSH: Stop DSH`
   **预期结果**：服务停止，承载面引用清空，视图不残留状态

### 异常场景

- **无活跃会话**：打开后消息流为空（hero 相位）→ 插件 `autoResumeSession` 自动恢复最近非空白会话，消息流出现内容
- **secondarySidebar 不可用**：老版本 VS Code 不识别该声明 → schema 警告 + 右侧消息流视图缺失，其余承载面正常（降级可用，不阻断）
- **dsh 未运行**：open 触发启动流程，端口就绪后才写入 iframe URL（健康探测重试机制沿用现状）

## 边界收束

**此时必做**：
- URL 契约升级（buildFocusUrls 三值）
- 三容器视图声明（activitybar 会话列表 + secondarySidebar 消息流 + panel 输入区；活动栏保留现有消息流视图）
- engines 升 `^1.106.0`
- focus.js 多承载面编排 + 对应单测更新

**此时不做**：
- 输入区"普通标签页"备选方案 — 延后理由：仅当 panel 容器承载遇到实际问题时才需要；触发条件：panel 容器验证失败
- 容器自动展开策略（open 时展开哪些容器、底部面板 tab 标题、视图图标）— 属于 design 阶段决策

## 实现对齐

锚定实现路径前已读 `.intentflow/_packages/opendsh.yml`（现状基线：focus 双承载面描述，本次升级后需在 report 阶段校准）与 `D:\w_dev\dsh-focus\.intentflow\_packages\focus-plugin.yml`（插件三值契约确认）。

- **[URL 契约升级]**：改 `src/detect.js` 的 `buildFocusUrls`，输出 `{ sessions, conversation, composer }` 三值；对应更新 `test/detect.test.js`
- **[承载面声明]**：改 `package.json` contributes —— `activitybar` 容器新增会话选择区视图（保留 `opendsh.dsh-chat` 消息流视图）；新增 `secondarySidebar` 容器 + 消息流视图（新 view id `opendsh.dsh-conversation`，视图 id 全局唯一不能复用；容器 id 用连字符 `opendsh-focus-conversation`，viewsContainers id 不允许点号）；新增 `panel` 容器 + 输入区视图（`opendsh-focus-input` / `opendsh.dsh-input`）；`engines.vscode` 升 `^1.106.0`
- **[承载面编排]**：改 `src/focus.js` —— 由双承载面扩展为多承载面注册/复用/清理；`src/manager.js` 委托逻辑不变（focus.open/reset 接口保持）；对应更新 `test/focus.test.js`、`test/manager.test.js`
- **推导出的约束**（经用户确认）：
  - 基于 {secondarySidebar contribution point 2025-08~10 合入 vscode 主仓库（首次 #261619，定稿 10-27；1.106.0 已含）}，engines.vscode 必须 ≥ 1.106.0，否则 secondarySidebar 声明无效（schema 警告 + 视图缺失）
  - 基于 {viewsContainers.panel 支持 WebviewView}，输入区放底部面板可行，无需"普通标签页"备选（延后）
  - 基于 {DSH 多客户端共享会话}，四视图无需自研桥接，直接同端口不同 `?focus=` 页面
  - 基于 {视图 id 全局唯一}，辅助侧边栏消息流必须用新 view id，不能与活动栏 `opendsh.dsh-chat` 复用
- **design 决策**（交 design 阶段）：
  - open 时容器自动展开策略（全部展开 vs 仅活动栏展开 + 其余懒加载）
  - 底部面板 tab 标题（如 "DSH Input"）与视图图标
  - 视图默认显隐与拖拽初始高度
