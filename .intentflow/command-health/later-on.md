# 后续想法备忘：command-health

> 设计阶段识别但**此时不做**的事项，以及未来可能的演进方向。只记录想法，不做任何设计预留——需要时直接实现。

## 相关上下文

本次检测确认：命令链路（声明→注册→隐式激活→三入口）本身健康；实质 bug 是嵌套设置键（`launch.mode` / `experimental.windowsHidePatch`）被扁平键读取导致五模式不生效；附 3 处文档残留。

## 想法列表

- **L01：readSettings 键映射表集中化**
  - 现状：键转换散在 readSettings 的两行（`cfg.get('launch.mode')` / `cfg.get('experimental.windowsHidePatch')`）。目前仅 2 个嵌套键，直接写在函数体内可读性足够。
  - 何时做：未来嵌套键超过 3-4 个、或出现"设置键名 ≠ 字段名"的普遍映射时，抽成模块级映射表（如 `{ 'launch.mode': 'launchMode', 'experimental.windowsHidePatch': 'windowsHidePatch' }`）供 readSettings 遍历。
  - 备注：本次检测中提出；同时可顺带把单段键也并入表，形成"VS Code 键 → 内部字段"的唯一转换点，便于日后审计配置读取。

- **L02：命令声明-注册一致性自动检查**
  - 现状：本次检测手工核对了 contributes.commands（open/stop）与 extension.js registerCommand 一一对应，且 VS Code ≥1.74 对已声明命令隐式激活。没有自动化手段防止"声明了没注册 / 注册了没声明"的新增命令回归（当前仅 2 条命令，人工核对成本低）。
  - 何时做：命令数量增长、或出现菜单/快捷键引用命令而遗漏 contributes.commands 时；届时可在测试里加一条"从 package.json 读 commands 清单，与 extension.js 的 registerCommand 调用比对"的契约测试（读 package.json 需引入 require 或 fs——注意现测试零第三方依赖、且不 require vscode）。
  - 备注：本次检测的副产品发现。

- **L03：配置读取的真机冒烟测试**
  - 现状：配置键错位这类 bug 无法被纯单元测试的 mock 捕获（mock 按真实键名传值后，若实现仍用扁平键读，会因查无此键而回退——靠断言失败暴露；但若不回退的旧实现配合 mock 扁平键，则可能全绿）。本次修复后测试数据改用真实键名，回归敏感度已显著提高。
  - 何时做：若出现"mock 与真机行为分歧"的迹象（如用户在真实 VS Code 中反馈设置不生效而测试全绿），再考虑加一个最小真机冒烟（Extension Development Host 手动步骤写入 README 或 report 的经验区）。
  - 备注：设计决策 L01（真实键名直查）已把该风险压到最低，L03 仅为备选预案。

- **L04：安装段版本号自动化**
  - 现状：README 安装段出现过 `TheChengXi.opendsh-0.0.3`（本次已修为 0.1.0）——版本号手写两处（中英），发布时容易漏改。
  - 何时做：下次发版流程中，若再次发现版本号残留，把"README 安装段版本号与 package.json 一致"纳入 report 阶段的检查清单（report 模板 or 经验区固化），不必提前做工具化。

## 与当前设计的关系（轻量提示）

- L01 不改变本次 2 行修改，未来抽表时 readSettings 是唯一改造点。
- L02 是针对命令机制的健康度自动化，与本次"检测"主题一脉相承，但不影响本次命令链路代码。
- L03/L04 均为流程/文档预案，不涉及本次代码改动。