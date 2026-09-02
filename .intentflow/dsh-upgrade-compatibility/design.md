# 设计文档：DSH 升级兼容性修复（第二迭代）

## 0. 与需求文档的偏差

- **偏差**：需求文档把「诊断可见（日志定位断点）」列为核心功能 3；用户在设计启动时明确「没必要做日志」。
  **影响**：从本次范围移除一切日志/诊断增强，保留现有 `showErrorMessage` 弹错即可。范围收敛为「契约鲁棒 + stop→open 竞态修复」两项。

- **偏差**：需求阶段将「手动 open/stop 完全没反应的精确机制」标为 ⏸ 待运行时验证；因用户不做日志，本轮不靠新增日志定位。
  **影响**：改为「单元测试锁定契约 + stop→open 竞态修复」覆盖该嫌疑。autoStart 与手动命令同源（`extension.js` 注册 `opendsh.open == manager.open`）的结论不变，不调整同源性。

## 1. 模块清单

沿用 `.intentflow/_packages/opendsh.yml` 的既有分层：`extension`（入口）→ `manager`（编排）→ `detect/process/webview/patch`（能力层）。

- **extension.js**：上层（入口/薄壳）—— 注册命令与 autoStart。本次不改。
- **src/manager.js**：中间层（生命周期编排）—— open/stop/ensureReady/dispose。本次改 ensureReady 的端口归属判定与 stop 后状态清理。
- **src/detect.js**：下层（配置解析 + dsh 定位 + URL 组装）—— 本次改 resolveDsh 的定位实现，去硬编码。
- **src/process.js**：下层（跨平台进程/端口适配）—— 本次改 buildDshArgs 的参数组织。
- **src/webview.js / src/patch.js**：下层（UI 承载 / 实验补丁）—— 本次不改。

依赖方向（已有，无跨层）：`extension → manager → {detect, process, webview, patch}`；`detect` 与 `process` 相互独立。

## 2. 最小依赖链

```
extension.js(open 命令 / autoStart)
  → manager.open
    → manager.ensureReady
      → detect.resolveConfig + detect.resolveDsh   （决定「跑什么」）
      → process.isPortInUse / httpProbe / buildDshArgs / spawnDsh / waitForPort （决定「传什么、怎么跑」）
```

detect 与 process 的交界契约是 `resolved = { command, prefixArgs }`：detect 产出「可执行文件 + 前缀参数」，process 追加 dsh CLI 参数并 spawn。

**跨层依赖体检**：manager 单向依赖 detect/process（上层依赖下层，合法）；detect/process 不反向依赖 manager，两者之间无依赖。无跨层依赖。本次改动不新增任何依赖，仅调整上述三个模块的内部实现。

## 3. 测试策略

- **buildDshArgs（process）**：`node:test` 断言参数序列（`web` / `--patch` / `--host` / `--port` / `--no-open` 的取舍与顺序）—— 需运行时行为验证（锁定契约，dsh 升级后跑测试当场报警）。
- **resolveDsh（detect）**：`node:test` 注入假 `env` / `pathEnv` / `execFile` 断言定位优先级与兜底 —— 依赖注入点：[参数] 注入，不在内部创建。
- **ensureReady 端口判定（manager）**：沿用现有 `test/manager.test.js` 的 `makeHarness` 注入可变 `fakeProc`（`isPortInUse`/`httpProbe`）断言「stop 后 open 不误判」—— 依赖注入 + 运行时行为验证。
- **验证命令**：`node --test` —— 预期全绿。
- **Mock 边界**：只 mock 系统边界（`fs` / `child_process` / `net` / `http` / `vscode`），不 mock `detect` 与 `process` 之间的内部协作者。

## 4. 决策记录

### 决策 1：resolveDsh 去「node + lib/bin.js」硬编码，改以 shim / package.json bin 定位
- **决策**：resolveDsh 优先级调整为 `dshPath 设置 > PATH 上的 dsh 命令（npm shim）> npm 全局真实入口`；npm 全局入口按 `@deepseek-ai/dsh/package.json` 的 `bin` 字段解析真实入口，不再硬编码 `lib/bin.js`。
- **理由**：dsh 内部文件结构（bin 文件名/目录）若变化，硬编码 `lib/bin.js` 立即失效；而 npm 生成的 `dsh`/`dsh.cmd` shim 恒指向 `bin` 字段声明的真实入口，对 opendsh 透明。原「node 直跑 bin.js 绕 shim」省一层 cmd 嵌套，代价是路径脆弱；鲁棒性收益远大于一层 shim 开销。
- **影响**：Windows 上 spawn `dsh.cmd` 走 `shell:true`（`spawnDsh` 已有 `needShell`）；删除 `resolveNpmGlobal`/`runNpmPrefix`/`cachedNpmPrefix` 对 `lib/bin.js` 的硬编码，顺带消除「resolveDsh 未传 deps → npm prefix 探测实际失效」的隐性 bug。

### 决策 2：buildDshArgs 收敛为「最小稳定参数集」+ 单测锁死
- **决策**：`buildDshArgs` 只输出必须且最稳定的参数——恒拼 `web`；有 patch 才拼 `--patch`（置于 `--host`/`--port` 之前）；host 非默认 `127.0.0.1` 才拼 `--host`；恒拼 `--port`；恒拼 `--no-open`。参数集用单元测试锁死顺序与取舍。
- **理由**：不引入契约探测或版本分支（两者都意味着每版 dsh 仍需维护，治标不治本）。把 opendsh 与 dsh 的耦合面收敛为「入口动词 `web` + 四个参数」的最小集，dsh 下次若改 CLI，仅改一处且 `node --test` 立即报警，摆脱「黑盒查 bug 再重编译」。
- **影响**：无 patch 文件时不传 `--patch`；host 为默认值时省去 `--host`（dsh web 默认即 loopback）。

### 决策 3：stop→open 引入「刚停止残留」判定，消除端口误判竞态
- **决策**：stop（含 integrated dispose 终端、child 杀进程）保持即时返回不等待进程退出；ensureReady 在「端口在占用且无 child/terminal 记录、httpProbe 命中 dsh」分支，用「距最近一次 stop 的时间」区分「本窗口刚停的残留（等待其释放后重新 spawn）」与「外部手动起的 dsh（直接打开）」。
- **理由**：这是「autoStart 好使、手动 Stop→Open 不好使」的最可能根源——autoStart 是冷启动（端口干净），手动 Stop→Open 是热切换（旧进程未退完）。不加区分时，open 会把旧残留误判为外部 dsh 直接打开旧服务，或误判端口占用而报错。
- **影响**：manager 增加一个 stop 时间戳状态（同 `lastOpenAt` 模式）；ensureReady 该分支增加「等待端口释放」的确定性判定与超时边界（超时后按现有失败路径报错）。

## 5. 改动点清单

**修改文件**
- `src/process.js`：`buildDshArgs` 参数组织（决策 2）。
- `src/detect.js`：`resolveDsh` 定位优先级与实现（决策 1）。
- `src/manager.js`：`ensureReady` 端口归属判定 + stop 时间戳（决策 3）。

**测试文件**
- `test/process.test.js`：锁定 `buildDshArgs` 参数集。
- `test/detect.test.js`：锁定 `resolveDsh` 优先级与兜底。
- `test/manager.test.js`：锁定 stop→open 竞态（残留等待 vs 外部 dsh 直开）。

**新增文件**：无。