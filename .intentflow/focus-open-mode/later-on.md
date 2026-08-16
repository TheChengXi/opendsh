# 后续想法备忘：聚焦打开模式

## 想法列表

### L01：DSH 聚焦插件本体（shadow root + ?focus 分发）的开发、构建与挂载
- 现状：需求与设计确认聚焦能力需 DSH 前端补一个 client 插件（`?focus=conversation` 渲染消息流、`?focus=composer` 渲染输入区、隐藏 280px sidebar）。opendsh 只消费这两个 URL 契约。已探查到加载链路：patch `insert`（见 `.dsh/dsh.mcp.patch.yml` 既有机制）挂载本地/发布插件，DSH 按 `/plugins/<id>/client.js` 伺服插件构建产物。
- 何时做：opendsh 侧 focus 打开方式结构落地、并需要一个可实测的 DSH 界面时，进入聚焦插件的一版开发：编写（复用 `dsh-client-ui-slots/` `dsh-client-ui-layout` 的 `ctx.slots.register` shadow root 与 `conversation.composer` / `conversation.session` 渲染契约）→ tsdown/tsc 构建 `client.js` → 挂载 → 重启 dsh web → 浏览器实测"composer 页发消息、conversation 页自动同步"。
- 备注：基线对齐 `@deepseek-ai/dsh@0.1.0-rc.6`（node v25 + npm 可用，rc.6 peer 包已随 DSH node_modules 提供）。可参考社区 `@ahggg/dsh-side-chat`（同 rc.6）的插件骨架与 patch 挂载方式。

### L02：侧栏对话视图的"非对称拆分会话同步"真机验证
- 现状：设计阶段从源码确认 `conversation.session` 与 `conversation.composer` 同级可分离、DSH 会话是服务端事件日志故多页天然同步，但"侧栏只渲染消息流 + 主区只渲染输入区"这一非对称形态在真机上的边界（空白会话/无 session 上下文时 composer 是否正常渲染）未实测。
- 何时做：聚焦插件的 `?focus=composer`/`?focus=conversation` 可用后，随第一版一体实测（不单独造原型）。

### L03：聚焦模式下 multipleTabs / debounce / 每次 open 重建复用 的精化语义
- 现状：设计阶段将 focus 固定为双界面、忽略 multipleTabs（仅 tab 生效）、沿用现有 debounce 节流。每次 open 是复用既有双承载面还是重建，尚未最终定（倾向复用 + 仅聚焦，与现有 tab 单例语义对齐）。
- 何时做：focus.js 实现时段内由具体行为测试锁定，不提前预留接口。

### L04：输入区主区形态——是否退化到"轻量本地输入框"
- 现状：设计选定主编辑区 webview 用 DSH 原生 composer（`?focus=composer`），保留附件/多行/工具能力。若聚焦插件连不上或 DSH 版本不兼容，是否回退到 opendsh 侧自绘的一个简单本地输入框（经 MCP/会话 API 发包）列为可选降级。
- 何时做：聚焦插件不可用时的降级路径；默认不实现，保持简单。

## 与当前设计的关系（轻量提示）

- L01 是外部交付物，opendsh 侧接口已定（buildFocusUrls 输出 URL 契约）；届时 opendsh 无需改动。
- L02/L03 在 focus.js 实现阶段内闭环，当前接口无需提前预留。
- L04 若启用，会在 focus.js 内增加一条"composer 降级"分支，当前不设计，需要时直接加方法。
