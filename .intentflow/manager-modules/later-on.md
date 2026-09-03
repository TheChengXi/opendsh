# 后续想法备忘（manager-modules）

### 想法列表

- **L01**：配置读取 `readSettings` 抽离为独立模块
  - 现状：仍在 manager.js 内（本轮 scope 只拆五模式启动分发，不含此职责）
  - 何时做：后续若 detect/manager 复用设置读取、或增加更多设置键时
  - 备注：`readSettings` 产出扁平字段供 `detect.resolveConfig` 消费，抽离时机成熟时把点式键读取规则集中一处。

- **L02**：打开方式分叉 `openWebview` 抽离为独立模块
  - 现状：仍属 manager（systemBrowser/simpleBrowser/multipleTabs/单例四路分叉）
  - 何时做：打开方式继续膨胀/需独立复用 `webview.buildWebviewHtml`、面板旧页刷新逻辑时
  - 备注：本轮的"独立维护单一模式"诉求同样适用于打开方式，可借鉴同一接口契约思路。

- **L03**：五模式枚举联动告警
  - 现状：`detect.resolveConfig` 的 `LAUNCH_MODES` 与 `src/launch/index.js` 注册表同改——新增/改名模式时需两处同步（本次唯一跨文件联动点）
  - 何时做：出现新增第六种启动模式的真实需求时
  - 备注：届时可由 `LAUNCH_MODES`（或统一常量）驱动注册表校验，减少双源漂移；当前不建机制。

- **L04**：各启动器独立单测的 golden behavior 化
  - 现状：本轮已为每启动器配独立单测（mock 注入的 vscode/process/patch）
  - 何时做：后续改动频繁、需要更强回归保障时
  - 备注：可考虑把五模式各自的启动/停止/复位契约做成共享断言函数，减少重复。

- **L05**：manager.test.js 是否拆解
  - 现状：保留全部集成用例作为行为锁（不拆不改）
  - 何时做：manager 若继续增长到难以辨认时
  - 备注：本轮刻意不拆，用全绿作拆分"行为未变"的最强证明；拆解属独立决策。

### 与当前设计的关系（轻量提示）

- L01/L02 会扩展 manager 的职责边界，但当前接口无需提前预留，届时直接抽模块即可。
- L03 会影响 `src/launch/index.js` 与 `detect.js`，当前保持单一枚举源，未来加模式时再同步改造。