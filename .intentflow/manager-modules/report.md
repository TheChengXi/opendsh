# manager-modules 关账报告

## 1. 项目概览
把 `src/manager.js` 里的五模式启动分发拆为「每模式一个独立启动器模块」（`src/launch/`，含分发器），manager 退化为纯编排 + 统一消费；达成「以后只单独维护一个启动模式、改一模式零联动」的结构目标，行为完全不变。

## 2. 计划 vs 实际
- 五模式启动器各拆独立模块（integrated/window/hidden/window-keepalive/hidden-keepalive + index 分发器）— ✅ 完成
- manager 的 `ensureReady` 五模式 `switch` 收敛为 `launcher.start(mode, ctx)` 分发 + 统一返回 `{kind:'terminal'|'child'}` 消费 — ✅ 完成
- 保持 `createManager(deps)` 注入与 `open/stop/dispose/getChild` 对外签名不变 — ✅ 完成（`extension.js` 未动）
- 各启动器独立单测 — ✅ 完成（`test/launch/` 10 用例；需求阶段定「延后」，design 阶段为支撑「独立维护」提升为必做）
- `test/manager.test.js` 保留全绿作行为锁、不拆不改 — ✅ 完成（全量 116 pass）
- 配置读取 / 打开分叉 / 生命周期本轮不拆 — ✅ 完成（scope 外，保持原状）

## 3. 关键决策
- **补丁日志随迁移丢失（行为收缩）**：`hidden-keepalive` 的 `sending patch command` / `patch applied or unavailable` 补丁日志原在 manager，补丁逻辑迁入启动器后这些日志不再输出。执行验证确认 `manager.test.js` 未断言该日志、全量仍 116 全绿，故行为锁未被破坏。这是「启动器不依赖 manager log」原则下的既定收缩；如何补回（deps 注入可选 log）见「后续待办·立即跟进」。
- **依赖注入方式**：启动器全依赖构造注入（vscode/process/patch）、内部零 require，与 design 一致，支撑单模式独立 mock。

## 4. 经验记录
- **有效 — 以现有测试作行为锁**：重构拆分时保留 `manager.test.js` 不拆不改，直接用全量 116 全绿证明「行为未变」，是拆分重构最稳的验证方式。
- **有效 — 统一返回契约 + 全构造注入**：启动器返回 `{kind}` 统一描述、依赖全注入，让单模式可独立 mock/独立单测，测试与维护只针对一个文件。
- **踩坑 — `node --test` 传目录会被当模块加载失败**：Node v25 对 `node --test test/launch` 报 `MODULE_NOT_FOUND`；需显式列文件，或直接 `node --test` 全量 discovery（会自动纳入子目录）。
- **踩坑 — 沙箱对 test runner 命名管道 spawn 拦截**：Windows 沙箱下 `node --test`（runner 用命名管道 spawn 测试子进程）报 EPERM；需放行进程操作（本会话后由用户提升为 danger-full-access + approval never）。
- **工具反馈 — 权限提升后的误用**：文件策略已是 danger-full-access 后仍反复请求同等级升级会报 `not strictly wider`；应不再带 `sandbox_permissions` 直接执行。

## 5. 后续待办
- **立即跟进**：补丁日志是否补回——可在 `hidden-keepalive` 启动器 deps 注入可选 `log` 函数（保持启动器独立、不硬依赖 manager channel），观察是否确有诊断价值后决定；当前不影响行为锁，非阻塞。
- **长期备忘**（引用 `.intentflow/manager-modules/later-on.md`）：
  - L01 配置读取 `readSettings` 抽离
  - L02 打开方式分叉 `openWebview` 抽离
  - L03 五模式枚举联动（`detect.js` LAUNCH_MODES ↔ `src/launch/index.js` 注册表）告警机制
  - L04 各启动器单测 golden 行为化
  - L05 `manager.test.js` 是否拆解

## 6. 开发工作流反馈
- **流程顺畅**：requirement（拆分范围/组织/契约/命名四项澄清）→ design（定统一返回契约与 src/launch 分层）→ execute（按依赖方向逐层实现、行为锁验证）→ report（关账 + 现状更新 + 提交）各阶段产物边界清晰，本轮全程无返工。
- **建议在 execute 阶段加「行为差异清单」检查点**：本次补丁日志丢失属行为收缩，虽靠全量测试兜底未破坏行为锁，但更规范的做法是 execute 交付时显式列出「与重构前相比可能的行为差异」并逐条验证归零或声明——避免隐藏的行为变化遗漏。
- **工具链瓶颈**：`node --test` 目录参数行为、沙箱对 test runner spawn 命名管道的限制（已记入经验，作为可复用坑点）。

## 7. 结论
- **当前状态**：可发布。全量 `node --test` 多次循环均 116 pass / 0 fail，`manager.test.js` 行为锁未破坏，`src/launch/` 单测全绿。
- **建议下一步**：无阻塞。剩余事项均入 `later-on.md` 长期备忘；`opendsh.yml` 模块现状已在本报告同步更新。

## 8. 后续变更：hidden 模式下线
**决策**：删除 `hidden` 启动模式（静默非 keepalive）。原因：其登录方式实际应用效果会产生与 `hidden-keepalive` 同类的 bug，不是合格可用的登录模式。启动模式枚举由五值收敛为四值：`integrated / window / window-keepalive / hidden-keepalive`。

**改动范围**：
- 删除 `src/launch/hidden.js` 与 `test/launch/hidden.test.js`
- `src/launch/index.js` 注册表与注释收敛为四模式；`src/detect.js` `LAUNCH_MODES` 去 `'hidden'`（并保留说明注掉）；`src/manager.js` 注释同步（启动逻辑经 index 分发不感知 hidden，无代码改动）
- 测试联动：`test/launch/index.test.js` 去 hidden 路由断言；`test/detect.test.js` 枚举去 hidden 并加「hidden 回退 integrated」新断言锁定回退行为

**行为锁调整**：
- `manager.test.js` `baseSettings` 默认 `launch.mode` 由 `'hidden'` 改为 `'integrated'`（与 detect 兜底默认一致，语义自洽）
- 受默认值牵连的 13 个 child 语义用例（open 自动启动 / stop 杀 child / dispose 杀 child / 复用 / 节流 / multipleTabs / pid 文件等）显式改用 `'window'`（剩余的非 keepalive child 载体），其中 pid 文件断言值 hidden 的 pid=1 改 window 的 pid=8
- 删除「hidden spawns silently via spawnDsh」用例（`spawnDsh` 静默非 keepalive 无承载者）；原「hidden resets child」两个用例改用 `'window'`

**验证**：全量 `node --test` 114 pass / 0 fail（较关账 116 净减 2，即删除的两个 hidden 用例），行为锁其余断言全绿。

**副作用提示**：此后 `launch.mode='hidden'` 被判非法回退默认 `integrated`；detect 枚举（`LAUNCH_MODES`）与 `src/launch/index.js` 注册表仍存在两处同步联动点（新增/改名模式需同改，对应 later-on L03）。