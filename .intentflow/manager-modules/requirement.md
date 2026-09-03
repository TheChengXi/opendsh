# 需求文档：manager 启动分发模块化（manager-modules）

## 项目意图
把 `src/manager.js` 里的**五模式启动分发**（`integrated` / `window` / `hidden` / `window-keepalive` / `hidden-keepalive`）
从 manager 中抽离为**每模式一个独立启动器模块**，manager 只做生命周期编排与统一消费；对外契约零变动，行为完全不变。

## 功能清单
1. 五模式启动器独立成模块（每模式一个文件）
2. manager 的 `switch(config.launchMode)` 收敛为按模式分发到对应启动器
3. 启动器统一返回契约，manager 消费后仍走原有 child/terminal 持有、pid 写入、超时复位逻辑
4. 现有 `test/manager.test.js` 全部用例保持通过（行为锁）

## 核心功能

### 核心功能1：五模式启动器独立模块
- **能力**：系统能够把 `integrated / window / hidden / window-keepalive / hidden-keepalive` 五条启动路径各自封装为独立启动器，每个启动器只负责本模式的"产出运行实例"。
- **业务价值**：manager 单文件瘦身，启动逻辑按模式内聚，便于单点维护与复用，符合"按五种启动模式划分分层"。

### 核心功能2：manager 统一分发与消费
- **能力**：系统能够依据 `config.launchMode` 把启动请求分发给对应启动器，并用**统一返回契约**接管返回的 terminal / child，后续的 `attachStderr`、`writePidFile`、`startedKeepAlive` 标记、启动超时复位（`resetTerminal` / `resetChild`）全部复用现有多有逻辑。
- **业务价值**：manager 从 switch 分支改为纯编排，职责单一，不破坏现有 open/stop/dispose 契约。

## 业务规则

### 按 launch.mode 分发（五模式）
- **场景**：`ensureReady` 进入启动路径，`config.launchMode` 决定用哪个启动器。
- **行为**：每个模式调用对应的启动器：
  - `integrated` → 组装 `buildTerminalCommand` 后 `createTerminal('DSH')` + `show` + `sendText`，注册 `onDidClose` 清引用；不写 pid。
  - `window` → `spawnDshVisible` 产出可见子进程。
  - `hidden` → `spawnDsh` 静默产出子进程。
  - `window-keepalive` → `spawnStandalone(showWindow=true)` 弹窗独立存活，产出含 pid 的伪 child。
  - `hidden-keepalive` → 先（可选 `windowsHidePatch`）检测 `patch.isApplied`、未打则 `createTerminal` 发 `patch.buildPatchCommand`；再 `spawnStandalone(showWindow=false)` 静默独立产出含 pid 的伪 child。
- **异常处理**：启动器 `start()` 抛错由 manager 统一 `showErrorMessage` 并返回 `{ready:false}`；端口等待超时仍走 `resetTerminal` / `resetChild` 复位，下次 open 重走启动。

### 对外契约不变
- **场景**：`extension.js` 注入与命令绑定、manager 对外 `open/stop/dispose/getChild` 签名。
- **行为**：`createManager(deps)` 的注入方式（detect/process/webview/patch/vscode）与对外签名完全不动；拆分仅发生 manager 内部与新增启动器模块。
- **异常处理**：任何拆分导致的契约/行为差异，以 `test/manager.test.js` 全部通过为否决门，不通过则不合并。

## 预设测试

> 从用户视角可执行的测试步骤，验证功能是否符合预期。

### 前置条件
- `test/manager.test.js` 已存在并覆盖五模式分发、keepalive 补丁、启动超时复位、pid 残留（现状基线）。
- 拆分完成后不新增/不删改该测试文件内容（作为行为锁）。

### 测试步骤

1. **[跑全量单测]**：执行 `node --test test/manager.test.js`
   **预期结果**：全部用例通过，与拆分前一致的绿。五模式分发、keepalive 补丁、超时复位、pid 读写行为逐条锁定。

2. **[五模式逐条断言]**：分别在 `launch.mode=integrated/window/hidden/window-keepalive/hidden-keepalive` 下执行 open/stop
   **预期结果**：与拆分前行为逐一对齐——integrated 走终端不写 pid、window 可见、hidden 静默、两个 keepalive 走 `spawnStandalone` 且 `dispose` 不终止、hidden-keepalive+patch 才发补丁命令。

3. **[确认 manager 瘦身]**：打开 `src/manager.js`
   **预期结果**：`switch(config.launchMode)` 分支已收敛为"按模式分发到启动器 + 统一消费"，五模式启动细节不在 manager 内联。

### 异常场景

- **[启动器抛错]**：某模式 `start()` 抛错 → manager 统一弹错 `{ready:false}`，不打开页面。
- **[启动超时]**：端口等待超时 → 复用分支复位 terminal/child，下次 open 重走启动，不产生"毒引用"。
- **[keepalive 误终止]**：`window-keepalive` / `hidden-keepalive` 下 `dispose` → 不终止服务（`startedKeepAlive` 保护仍生效）。
- **[补丁误发]**：`hidden-keepalive` 且未 `windowsHidePatch` → 不发补丁命令，仅静默独立启动。

## 边界收束

**此时必做**：
- 五模式启动器各拆一个独立模块（每模式一文件）。
- manager 的 `ensureReady` 启动分支收敛为按 `launchMode` 分发 + 统一返回契约消费。
- 保持 `createManager(deps)` 注入与 `open/stop/dispose/getChild` 对外签名不变。
- `test/manager.test.js` 保持全绿（行为锁，不拆不改）。

**此时不做**：
- 配置读取 `readSettings`、打开方式分叉 `openWebview`、生命周期 `stop/dispose` 本轮**不拆**（scope 已圈定只拆五模式启动分发）。
- 新增各启动器的独立单测—延后；风险已由 manager.test.js 全绿兜底，新增独立单测是否做交由 design 决策。
- pid 文件管理、节流、残留窗口判定逻辑不迁移出 manager（仍是 manager 编排职责）。

## 实现对齐

锚定现状基线：`_packages/opendsh.yml` 已把 `src/manager.js` 列为"DSH 起停与打开"组的文件，职责含"五模式分发、启动超时复位、hidden-keepalive 补丁"。本次拆分落地后需回校该 yml 的描述与文件归属。

- **[五模式启动器]**：[实现路径：在 `src/` 下新增按五模式切分的启动器模块（拟 `src/launch/` 目录或 `src/launch-*.js` 平铺，见 design 决策），各模块注入 `vscode/process/patch`，导出统一的 `start(ctx)` 接口；`integrated` 用 `proc.buildTerminalCommand`+`createTerminal`，`window`/`hidden` 用 `proc.spawnDshVisible`/`proc.spawnDsh`，两个 keepalive 用 `proc.spawnStandalone`，hidden-keepalive 内部承载可选补丁逻辑。]
- **推导出的约束**：启动器须返回**统一运行描述**（`{kind:'terminal',terminal}` 或 `{kind:'child',child}`），使 manager 无需感知各模式差异即可复用 `attachStderr` / `writePidFile` / `resetTerminal` / `resetChild` / `startedKeepAlive`；keepalive 产出的是**含 pid 的伪 child**（无真实子进程引用），统一契约须兼容。对吗？
- **design 决策**：
  - 目录组织：`src/launch/`（子目录 + index 分发器） vs `src/launch-*.js`（平铺）。
  - 启动器依赖注入方式：构造注入 deps（如 `createXLauncher({vscode,proc,patch})`） vs 模块内顶层 require。
  - 是否新增各启动器独立单测（vs 仅靠 manager.test.js 行为锁）。
  - 启动器统一返回契约的具体字段形态。

与预设测试的关系：实现路径上每个明确环节（五模式各启动器、统一消费、补丁逻辑、超时复位）都在预设测试/异常场景中有对应断言。