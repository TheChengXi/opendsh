# launch-modes 关账报告

## 1. 项目概览

把 DSH 启动方式的配置从三个纠缠且误导的设置（`showWindow` / `detached` / `experimental.silentKeepAlive`）重构为**单枚举 `opendsh.launch.mode`**（5 个模式，逐一枚举「输出载体 × 是否随 VS Code 存活」的有效组合）+ 独立补丁开关 `opendsh.experimental.windowsHidePatch`；并内置幂等的 DSH 源码补丁模块 `src/patch.js`，抑制 Windows 上静默后台时工具调用闪现控制台窗口。

## 2. 计划 vs 实际

| 计划（requirement） | 状态 | 说明 |
|---|---|---|
| 三态启动编排（实验版 / detached / 普通） | ✅ | 第一轮完成，第二轮重构为 5 模式单枚举 |
| 内置补丁模块 | ✅ | `src/patch.js`（幂等、已打则跳过） |
| 集成终端自动执行补丁 | ✅ | 仅 `hidden-keepalive` + `windowsHidePatch` 时 |
| showWindow 布尔→枚举 | 🔸 | 第一轮做完，随后被 `launch.mode` 取代并作废 |
| 单枚举 5 模式（载体 × 存活） | ✅ | 最终形态，默认 `integrated` |
| 桌面窗口载体恢复 | ✅ | 新增 `spawnDshVisible`（window 模式） |
| 补丁从实验分支剥离 | ✅ | `opendsh.experimental.windowsHidePatch` |
| 文档同步（README / yml） | ✅ | README 设置段 + 已知问题段、`opendsh.yml` 本报告阶段同步 |

未完成项：无（旧三设置「不迁移」是明确决策，非遗留）。

## 3. 关键决策

- **三设置 → 单枚举**：`showWindow` 名不副实、`detached` 把「窗口+存活」绑死、`experimental.silentKeepAlive` 把「静默+存活+补丁」三事绑死，且用户否掉了布尔兼容兜底（违反 AGENTS.md「禁止以防万一式兜底」）。改为枚举 5 个有效组合，天然排出「内置终端+独立存活」这个矛盾项。
- **默认值 `integrated`**：用户拍板「内置终端是默认」，替换原来的静默 `output` 默认。
- **恢复桌面窗口载体 `window`**：原设计把旧 `showWindow=true` 分支判为「无调用方」而删除，导致「桌面窗口 + 随关」从语义表消失；本次以独立函数 `spawnDshVisible` 补回。
- **补丁剥离**：补丁是「改源码」的实验动作，与载体/存活正交，不应绑死在某模式；独立为 `experimental.windowsHidePatch`，仅 `hidden-keepalive` 生效。
- **不迁移旧 key**：个人工具无老用户，重命名还写映射会重演「改了没生效」困惑；旧三键直接作废，由 VS Code 黄线提示用户手动改。

## 4. 经验记录

- **有效做法**：两正交维度（载体 3 态 × 存活 2 态）不拆两个设置，而是展开为单枚举的有效组合——下拉 5 项 + 每项 `markdownEnumDescriptions`，避免无效组合陷阱，用户无脑选。
- **踩坑**：① `showWindow` 命名误导，导致「改了没生效」；② 布尔→枚举兼容映射是「以防万一式兜底」，被用户否掉；③ web_search 对「VS Code 配置设计范式」这类查询返回大量无关中文站，命中率低；④ `node --test` 在沙箱下需 `--test-isolation=none`（spawn 子进程 EPERM）。
- **工具反馈**：web_search 对具体工程范式类查询价值有限，配置建模诉求更适合直接出方案让用户拍板。

## 5. 后续待办

- **立即跟进**：用户需在 VS Code 设置里删除旧的 `showWindow` / `detached` / `experimental.silentKeepAlive`（会黄线提示「未知配置」），改为 `opendsh.launch.mode`。
- **长期备忘**：见 `.intentflow/launch-modes/later-on.md`（L01 上游修复后补丁降级、L02 内置补丁与脱机脚本合并、L03 terminal 模式跨会话 pid、L04 POSIX 五模式完整复刻）。

## 6. 开发工作流反馈

- requirement 阶段产出「三态互斥 + showWindow 枚举」的模型，与用户真实意图「载体 × 存活两正交维度 + 恢复桌面窗口载体」在 design/对话中才暴露，导致一次成规模的返工。建议：requirement 阶段引导用户先铺满「维度 × 取值」的完整矩阵，再谈设置形态，能减少 design 返工。

## 7. 结论

- **当前状态**：可发布（95 测试全绿，稳定性循环 3 次通过，`package.json` JSON 合法）。
- **建议下一步**：`git commit` 关账后推送 GitHub 并打 release（本次一并执行）。