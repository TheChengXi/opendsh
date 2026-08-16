# 后续想法备忘：聚焦模式三区布局（focus-layout）

> 设计阶段识别但此时不做的事项，以及未来可能的演进方向。只记录想法，不做任何设计预留——需要时直接实现。

### 想法列表

- **L01**：输入区"普通标签页"备选方案
  - 现状：输入区主选底部面板容器（panel 容器 WebviewView）；备选 WebviewPanel（主编辑区标签页）仅当 panel 容器承载遇到实际问题时才启用
  - 何时做：panel 容器验证失败（如某些 VS Code 版本 WebviewView 在 panel 容器渲染异常）
  - 备注：需求阶段已标记延后；触发时 focus.js 需加回 createWebviewPanel 分支

- **L02**：容器自动展开策略精细化
  - 现状：open 时对三容器逐一 executeCommand 展开，失败静默
  - 何时做：用户反馈展开时机/范围不符合预期（如底部面板不想自动弹出、辅助侧边栏想默认收起）
  - 备注：可能需要新增设置项（如 `opendsh.focus.revealContainers`），design 阶段未定，需用户场景触发

- **L03**：视图 when 条件（已移除，记录为历史决策）
  - 现状：四视图原 `when: "opendsh.openWith == 'focus'"` 已移除——容器常驻活动栏（任何 openWith 模式都显示），openWith 只决定 open 行为。移除原因：容器内所有视图隐藏时整个容器从活动栏移除（VS Code 规则），导致默认配置下"扩展像坏了"
  - 何时做：若未来需要按模式显隐视图（如非 focus 模式隐藏输入区视图），按需加回 when 表达式
  - 备注：改动 package.json 的 when 表达式即可，无需代码改动

- **L04**：secondarySidebar 在旧版本 VS Code 的降级
  - 现状：engines 升 ^1.106.0，低于此版本 secondarySidebar 声明无效（schema 警告 + 右侧视图缺失）
  - 何时做：需要支持老版本 VS Code 时；降级方案 = 辅助侧边栏消息流视图改挂 activitybar 容器（活动栏消息流已有，实际是去掉右侧视图）
  - 备注：engines 约束已从根上避免，仅当用户强行在老版本加载时触发

- **L05**：插件侧 list occupant 聚焦的 opendsh 联动
  - 现状：@dsh-focus/focus-plugin 的 later-on 提到 list occupant 单条目聚焦（消息流中某条消息独立展示）；当前四视图只覆盖三槽整体
  - 何时做：出现"单条工具调用/消息独立窗口"用例
  - 备注：届时 VIEW_SPECS 表加一行 + package.json 加声明即可（表驱动设计的收益点）

- **L06**：四视图会话联动（已确认原生支持，无需实现）
  - 现状：四视图同源共享 localStorage `dsh.sessions.current`，任一视图切换会话其余自动跟随；DSH 跨实例消息同步为原生能力
  - 何时做：永不做——已实证原生满足，仅记录事实防重复设计
  - 备注：设计验证结论，非待办

### 与当前设计的关系（轻量提示）

- L01 需要 focus.js 加回 createWebviewPanel 分支，但 VIEW_SPECS 表驱动结构不影响该回退（单独分支即可）。
- L02 影响 open() 的展开逻辑，不触及表结构与 provider 注册。
- L03/L04 均只改 package.json 声明，零代码改动。
- L05 是表驱动设计的扩展收益，届时只增行。
