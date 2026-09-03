# 设计文档：manager 启动分发模块化（manager-modules）

## 0. 与需求文档的偏差（设计阶段新发现）

- **偏差 A**：需求把「新增各启动器独立单测」标为延后，但用户新诉求「以后只单独维护一个启动模式」要求**每个模式可独立验证**——没有独立单测，改一个模式仍要回溯 manager 集成测试。
  — **影响**：设计决定为每个启动器新增独立单测（支撑"独立维护单一模式"），`manager.test.js` 仍保留作为集成行为锁。

- **偏差 B**：需求假设依赖注入方式待 design 拍板；验证后确认 `process.js`/`patch.js` 是不依赖 vscode 的下层原语、`vscode` 仅运行时/测试 mock 可得。
  — **影响**：确定启动器**全部依赖经构造注入**（vscode/process/patch 都走注入），启动器内部零 require，达成完全隔离与可 mock——这是"单模式独立维护"的结构基础。

- **偏差 C**：需求提到 `detect.resolveConfig` 含 `LAUNCH_MODES` 枚举校验（非法值回退 `integrated`），而分发器也有 mode→launcher 映射。
  — **影响**：标记一个**枚举联动点**（见"最小依赖链"）：新增/改名启动模式时，`detect.js` 枚举与 `src/launch/index.js` 注册表须同步；这是唯一跨文件的联动，记入 later-on，本轮不做联动告警机制。

## 1. 模块清单

- **src/manager.js**：[编排层·上层使用方] — 职责：生命周期编排（open/stop/dispose）、pid、节流、残留、确保就绪后**统一分发启动**；不感知单个模式实现 — 依赖：detect/process/webview/patch/vscode（构造注入）、src/launch（新增）
- **src/launch/index.js** [新增]：[分发器？] — 职责：持有 `mode → launcher` 注册表，`start(mode, ctx)` 按 `config.launchMode` 分发到对应启动器 — 依赖：各启动器（构造后持有）
- **src/launch/integrated.js** [新增]：[启动器] — 职责：`integrated` 模式——`proc.buildTerminalCommand` 组命令 + `vscode.createTerminal` + show/sendText + 注册 onDidClose；不写 pid — 依赖：注入的 vscode/process 原语
- **src/launch/window.js** [新增]：[启动器] — 职责：`window` 模式——`proc.spawnDshVisible` 产出可见子进程 — 依赖：注入的 process 原语
- **src/launch/hidden.js** [新增]：[启动器] — 职责：`hidden` 模式——`proc.spawnDsh` 静默产出子进程 — 依赖：注入的 process 原语
- **src/launch/window-keepalive.js** [新增]：[启动器] — 职责：`window-keepalive` 模式——`proc.spawnStandalone(showWindow=true)` 弹窗独立、产出含 pid 的伪 child — 依赖：注入的 process 原语
- **src/launch/hidden-keepalive.js** [新增]：[启动器] — 职责：`hidden-keepalive` 模式——可选 `windowsHidePatch` 时检测 `patch.isApplied`、未打则 createTerminal 发 `patch.buildPatchCommand`；再 `proc.spawnStandalone(showWindow=false)` 静默独立、产出含 pid 的伪 child — 依赖：注入的 vscode/process/patch
- （不新增 detect/process/patch/webview 改动；webview 打开、配置读取、stop/dispose 均不在本轮拆）

### 各启动器统一接口契约
- 工厂：`createX(deps)` → `{ start(ctx) }`（deps = { vscode, process, patch }，按需取用）
- `start(ctx)`，ctx = { resolved, config, workspace, patches }
- **统一返回**（manager 据此消费，无需感知模式差异）：
  - `{ kind: 'terminal', terminal }`（仅 integrated）
  - `{ kind: 'child', child }`（child 带 pid；keepalive 模式下 child 为 `{ pid }`，无真实子进程引用）

## 2. 最小依赖链

```
manager（编排） → src/launch/index（分发器） → {integrated, window, hidden, window-keepalive, hidden-keepalive}
                    各启动器 → 注入的 process/patch/vscode（下层原语，构造注入）
```

**跨层体检**（逐层确认无反向依赖）：
- 启动器**不依赖** manager：不 import manager，不接触 open/stop/dispose/pid/节流——只做"本模式启动"。
- 启动器**互不依赖**：`integrated` 不感知 `hidden-keepalive`，反之亦然——**改一个模式零联动**。
- 启动器仅依赖**构造注入的下层原语**（process/patch/vscode），不反向依赖；detect 仍由 manager（上层）单独调用，无新跨层。
- 既有结构中无新增跨层依赖，无需纳入本次修复项。

**唯一枚举联动点**（本轮不建机制，仅记录）：`detect.resolveConfig` 的 `LAUNCH_MODES` 枚举 与 `src/launch/index.js` 注册表须同步维护（新增/改名模式时才需两处同改）。

## 3. 测试策略

- **验证方式**：每模块标注：
  - 各启动器 — 需运行时行为验证（mock 注入的 vscode/process/patch，断言 `{kind,引用}` 返回）— 理由：涉及 createTerminal/spawn 副作用
  - 分发器 — 需运行时行为验证（mock 各启动器，断言 mode→start 正确映射 + 未知 mode 处置）
  - manager 改造 — 沿用现有 `manager.test.js` 全部用例（集成行为锁）
- **依赖注入点**：启动器 [构造器注入] deps（vscode/process/patch），不在内部 require/创建 — 与现有 createManager(deps) 模式一致
- **验证命令**：
  - [启动器+分发器单测] `node --test test/launch/` — 预期：全绿
  - [现有集成行为不变] `node --test test/manager.test.js` — 预期：全绿（不拆不改，作行为锁）
  - [全量] `node --test` — 预期：全绿
- **Mock 边界**：只 mock 系统边界（vscode 对象、process 的 spawn/execFile、patch）与 `manager.test.js` 既有 harness；不 mock manager 内部编排协作者。启动器测试 mock 点 = 其注入的 vscode/process/patch（即系统边界），启动器内部逻辑不 mock。

## 4. 决策记录

- **决策 D1**：目录用 `src/launch/` 子目录收纳六文件（5 启动器 + index 分发器），而非平铺 `src/launch-*.js`。
  - 理由：5 个同主题文件平铺会让 `src/` 噪音骤增；子目录把"启动器族"聚为一层，语义清晰，贴合"按五种启动模式划分分层"。对比过平铺方案，取舍是子目录新增一级目录结构，换来族内内聚。
  - 影响：新增 `src/launch/` 目录；`src/launch/index.js` 作为对外唯一入口（manager require 它）。

- **决策 D2**：启动器**全部依赖构造注入**（vscode/process/patch），内部零 require。
  - 理由：这是"只单独维护一个启动模式"的结构根基——一个启动器文件 = 本模式全部逻辑 + 全部依赖可注入可 mock + 自己的单测，改它不碰任何其他文件。对比"启动器顶层 require process/patch"：会引入外部依赖点，测试需穿透 import，隔离不彻底。
  - 影响：每个启动器文件自给自足；分发器 `create(deps)` 负责把所有启动器实例化。

- **决策 D3**：统一返回契约 `{kind:'terminal'|'child', 引用}`，manager 按 kind 分支消费。
  - 理由：让 manager 对五模式零感知——只开关 kind 两类，`attachStderr`/`writePidFile`/`resetTerminal`/`resetChild`/`startedKeepAlive` 全部复用现有逻辑。对比"每启动器返回不同结构"会让 manager 重新引入 switch，破坏独立维护。
  - 影响：keepalive 模式的 `{pid}` 伪 child 与真实 child 均归入 `{kind:'child'}`；`attachStderr` 对无 stderr 对象已安全返回（现有行为）。

- **决策 D4**：新增各启动器独立单测（`test/launch/`），不并入 `manager.test.js`，后者保留为集成锁。
  - 理由：直接支撑用户"以后只维护一个启动模式"——改某模式只需更新其单测对应 case，其他模式的测试文件零改动。若只靠 manager.test.js，改一个模式也会牵动它的一条 case，不符合独立维护诉求。
  - 影响：新增 5 个启动器单测文件（+集成性分发器测试可选）；`manager.test.js` 维持现状全绿。

- **决策 D5**：保持 `createManager(deps)` 对外契约与 `open/stop/dispose/getChild` 完全不变；launch 由 manager 内部创建。
  - 理由：契约不变则 `extension.js` 零改动、命令绑定零影响，符合需求边界，也把拆分影响收敛到 manager 内部。
  - 影响：`src/manager.js` 只改 `ensureReady` 的启动分支（switch → `launcher.start` 分发 + 统一消费），其余函数不动。

## 5. 改动点清单（已有项目）

**新增文件**
- `src/launch/index.js` — 分发器（mode→launcher 注册表 + `start(mode, ctx)`）
- `src/launch/integrated.js` — integrated 启动器
- `src/launch/window.js` — window 启动器
- `src/launch/hidden.js` — hidden 启动器
- `src/launch/window-keepalive.js` — window-keepalive 启动器
- `src/launch/hidden-keepalive.js` — hidden-keepalive 启动器
- `test/launch/integrated.test.js` / `window.test.js` / `hidden.test.js` / `window-keepalive.test.js` / `hidden-keepalive.test.js`

**修改文件**
- `src/manager.js` — 仅 `ensureReady` 启动分支：内建 5 个模式的分支收敛为「按 `config.launchMode` 调 `launcher.start` → 按统一返回 kind 消费（terminal/child）+ attachStderr + writePidFile + startedKeepAlive」。其余函数不碰。

**不修改**：`extension.js`、`src/detect.js`、`src/process.js`、`src/patch.js`、`src/webview.js`、`test/manager.test.js`（行为锁）。

**文档同步（report 阶段）**：`.intentflow/_packages/opendsh.yml` 中 manager 组文件清单与职责描述、README 若有模块说明需回校。