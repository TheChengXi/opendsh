# 设计文档：command-health

## 0. 与需求文档的偏差（设计阶段新发现）

- **偏差 1 — 修复点精确化为单个文件的 2 行**：需求阶段表述为"readSettings 用点式键读取"。设计阶段逐行核验后确认：修改点仅为 `src/manager.js` `readSettings` 中的 2 个 `cfg.get` 键名（`launchMode` → `'launch.mode'`、`windowsHidePatch` → `'experimental.windowsHidePatch'`），赋值字段名（`launchMode` / `windowsHidePatch`）与 resolved 配置契约**保持不动**。— **影响**：改动面收敛为 1 个源文件 + 1 个测试文件 + 3 处文档；不触碰 detect.js/process.js/patch.js。
- **偏差 2 — detect.test.js 确认无需修改**：`detect.resolveConfig` 的输入就是 `readSettings` 产出的**扁平配置对象**（字段 `launchMode`/`windowsHidePatch`），与 VS Code 配置键无关；detect.test.js 直接传扁平字段是正确契约。需求阶段未明确此边界，设计阶段确认后可排除该文件。— **影响**：测试改动仅 manager.test.js。
- **偏差 3 — 测试对齐的精确做法**：需求阶段写"测试 harness 的 cfgGet 支持点式键"有歧义。设计阶段细化：**不改 cfgGet 实现**（它本就是 `settings[key]` 直查），只把测试数据（baseSettings + 各用例 settings）的键名换成真实键名（`'launch.mode'` / `'experimental.windowsHidePatch'`）。点式 key 作为对象属性直命中——若未来键名再错位，harness 查不到 → undefined → resolveConfig 回退 → 断言失败，回归立现。— **影响**：回归敏感度由"测试数据与真实键一对一对齐"保证，无需模拟 VS Code 的 section 前缀/点段拆分。

## 1. 模块清单

- **[extension.js]**：上层（入口） — 职责：注册 open/stop 命令、状态栏按钮、URI 深链；自身无业务逻辑 — 依赖：manager.js（注入 detect/process/webview/patch/vscode）— 本次**不改**
- **[src/manager.js]**：中间层（业务编排） — 职责：open/stop 生命周期、五模式分发、pid 持久化、webview 单例；`readSettings` 是本次唯一源文件修改点 — 依赖：detect/process/webview/patch/vscode — **本次改 readSettings 2 行**
- **[src/detect.js / src/process.js / src/webview.js / src/patch.js]**：下层（纯计算/进程/展示适配，不依赖 vscode） — 职责：配置解析、spawn/kill/端口探测、webview html、幂等补丁 — 依赖：互不依赖 — 本次**不改**
- **[test/manager.test.js]**：测试 — 职责：编排行为断言 — 依赖：src/manager + 各下层 mock — 本次改 baseSettings 与用例 settings 的真实键名
- **[package.json / README.md]**：文档/声明 — 本次清理 3 处残留（见改动点清单）

## 2. 最小依赖链

命令链路（本次不触碰，已确认健康）：

```
contributes.commands（声明） → vscode 隐式激活（≥1.74） → extension.js registerCommand
  → manager.open / manager.stop → detect|process|webview|patch（注入）
```

本次修复链路：

```
vscode.workspace.getConfiguration('opendsh')      [manager.js readSettings]
  → cfg.get('launch.mode') / cfg.get('experimental.windowsHidePatch')   ← 本次改点
  → 扁平 settings { launchMode, windowsHidePatch }                       [契约不变]
  → detect.resolveConfig → 五模式 switch 分发                             [不改]
```

 **跨层依赖体检**：逐文件确认无反向依赖——detect/process/webview/patch 均不 import vscode、不引用 manager；manager 通过构造器注入依赖（`createManager(deps)`），不内部创建。**无跨层依赖，无需新增修复项。**

## 3. 测试策略

- **验证方式**：
  - `manager.js` 键修复 — 需运行时行为验证（config 读取路径），由 manager.test.js 断言
  - `package.json`/`README` 文档清理 — 肉眼/文本验证（grep 无残留即可）
- **依赖注入点**：不变——manager 继续用 `createManager(deps)` 构造器注入；本次不新增注入点
- **Mock 边界**：仅 mock 系统边界（vscode 配置/终端/面板/进程、spawn、探测）。测试数据改动不扩大 mock 范围
- **验证命令**：
  - [全部单测]：`node --test --test-isolation=none` — 预期：全绿（95 + 语义对齐后不变数）
  - [嵌套键生效]：`node --test --test-isolation=none test/manager.test.js` 中 window-keepalive / hidden-keepalive+patch 用例 — 预期：走 spawnStandalone / 补丁分支
  - [回归敏感度]：人为把 `cfg.get('launch.mode')` 改回 `cfg.get('launchMode')` 重跑 — 预期：对应用例失败（证明测试锁住了键名）

## 4. 决策记录

- **决策 L01：测试数据用真实键名，cfgGet 不做点段模拟**
  - **理由**：VS Code 的 `getConfiguration(section).get(key)` 本质是"完整键 = section + 点式 key"的字面命中；测试 harness 的 `settings[key]` 直查已等价（settings 对象直接用真实键名做属性）。方案 B（模拟 section 前缀 + 嵌套对象拆分）复杂且无新增捕获力——用真实键名后，键错位必然导致查无此键 → 回退 → 断言失败，回归被抓住。方案 A 改动最小、fail 面最小。
  - **影响**：manager.test.js 中 baseSettings 与 10+ 处用例 settings 的键名全部替换为 `'launch.mode'` / `'experimental.windowsHidePatch'`；cfgGet 一行不动。
- **决策 L02：readSettings 保留扁平字段名，只改 cfg.get 键名**
  - **理由**：`resolveConfig`/五模式 switch/detect.test.js 的契约都是扁平字段 `launchMode`/`windowsHidePatch`。若把字段也改点式，会波及 detect.js 与 detect.test.js，扩大改动面却无行为收益。键映射只在 readSettings 一处集中，符合"配置键 → 内部契约"的单点转换原则。
  - **影响**：改动收敛到 2 行；detect.js、detect.test.js、process.js、patch.js 零改动。
- **决策 L03：文档清理范围 = package.json openWith description + README 安装段版本号 + README simpleBrowser 历史叙述**
  - **理由**：三处均为"已删除功能的残留描述/过时版本号"，会误导用户；openWith 的 markdownDescription 在设置 UI 直接可见，误导性最高，优先。README 中英两版同步清理。
  - **影响**：package.json 中英双语 description 两处改写；README 中文 2 处 + 英文 2 处改写。

## 5. 改动点清单

**已有项目（改动点）**：

| 文件 | 位置 | 改动 |
|---|---|---|
| `src/manager.js` | readSettings（~L133-134） | `cfg.get('launchMode')` → `cfg.get('launch.mode')`；`cfg.get('windowsHidePatch')` → `cfg.get('experimental.windowsHidePatch')` |
| `test/manager.test.js` | baseSettings（L96）+ 各用例 settings（L394/480/520/530/539/546/555/565/573/581/588/596） | 键名替换：`launchMode` → `'launch.mode'`、`windowsHidePatch` → `'experimental.windowsHidePatch'`（值不变） |
| `package.json` | openWith description（~L130-134） | 中英双语删除"（仅作为初始值；活动栏面板在运行时切换并记住它）"残留，改为纯 settings 决定（无面板、无状态记忆） |
| `README.md` | 中文安装段（L74）、英文安装段（L162）、中文 openWith simpleBrowser 叙述（L30）、英文（L109-110） | 版本号 `0.0.3` → `0.1.0`；删除"单标签页改造前的默认方式"历史叙述（中英） |

**新增文件清单**：无（仅文档内修改）。

**涉及但不改**：extension.js、src/detect.js、src/process.js、src/webview.js、src/patch.js、test/detect.test.js、test/process.test.js、test/webview.test.js、test/patch.test.js。