# webview-reload-hardening 关账报告

## 1. 项目概览
修复 openDSH 在 dsh 服务重启/冷启动期间页面滞留问题：webview 壳加时间戳 cache-buster（绕开浏览器缓存回退旧 HTML）、健康探测自动重试（server 就绪才加载 iframe）、manager 按 server 启动标记强制刷新旧面板；同时定位并修复了工作区 `.dsh/dsh.mcp.patch.yml` 的 focus 插件包名错误（导致 dsh 启动即崩）。

## 2. 计划 vs 实际
- ✅ webview 壳 cache-buster：iframe URL 每次打开带全新 `?t=<ts>`（已有 query 用 `&`），磁盘缓存无法回退旧页面
- ✅ 健康探测 + 退避重试：`no-cors` fetch 探测 server 监听状态，1.5s 起指数退避、封顶 10s、上限 60 次，就绪后才给 iframe 赋值 src
- ✅ manager stale 强制刷新：记录 `serverStartedAt`（spawn 成功时刻），面板创建早于它 → open 时重设 html，否则保持"仅聚焦"
- ✅ 测试：85 个全绿（webview 新增 7 断言 + manager 新增 stale 场景），`npm test` 通过
- ✅ 打包：version 0.0.4 → 0.0.5，`opendsh-0.0.5.vsix`（40.2 KB）成功
- ✅ 环境修复：`dsh.mcp.patch.yml` 的 `name: 'dsh-focus-mode'` → `'@dsh-focus/focus-plugin'`（实际安装包名）；清理 3080 端口残留进程（EADDRINUSE）
- ✅ 全量验证：带 patch 启动 200，boot manifest 39 个插件 bundle 全部 200（含 focus-plugin）
- ❌ 无未完成项

## 3. 关键决策
- **iframe 初始不挂 src**：由探测脚本赋值，避免"连接拒绝/半死"白屏，且保证每次加载都是 server 就绪后的全新页面
- **探测用 `no-cors` fetch**：只区分"能连上/连不上"；HTTP 4xx/5xx 属 dsh 自身行为，壳不干预（与原始设计"壳只承载、不判断业务"一致）
- **stale 判断用时间戳而非 pid 对比**：`serverStartedAt > panel._createdAt`，避免 detached/WMI 伪 child 的 pid 语义复杂度
- **csp 增加 `connect-src` + `script-src 'unsafe-inline'`**：探测脚本必需；frame-src 仍放行原始 url（不带 cache-buster）

## 4. 经验记录
- **有效做法**：
  - 全量验证法：从 `__DSH_BOOT__` 提取所有插件 URL 逐个 curl，比单点测试能立刻区分"单插件问题"vs"系统性失败"（38/39 全 200 证明环境健康）
  - rev 哈希对比：磁盘文件 sha1 前 12 位 vs 报错 URL 的 rev，秒判"旧缓存页面"还是"文件不一致"
  - `--dump-config`（只解析不加载）与真实启动（加载）分离定位：配置树 OK 但启动崩 → 问题在加载阶段
  - dsh 报错要看 AggregateError 的 `errors` 数组（`#include` 是 include 插件内部标识，误导性强；真实错误是 errors 里的 EADDRINUSE 和 ERR_MODULE_NOT_FOUND）
- **踩坑**：
  - git bash `/tmp` 与 node `C:\tmp` 路径语义不同，跨工具传路径需 cygpath/绝对路径
  - iframe 跨源（webview origin ≠ http://localhost）无法捕获内部加载失败事件，必须父页主动探测
  - dsh 插件树加载失败是**硬失败**（启动即崩），与单插件 bundle 404（仅横幅警告）是两种错误等级
- **工具反馈**：dsh 崩溃时无日志文件，只能靠手动启动捕获 stderr；建议 dsh 侧补启动日志落盘

## 5. 后续待办
- **立即跟进**：
  - focus-open-mode 未提交产出的关账（工作区含 extension.js / src/detect.js / src/focus.js / test/focus.test.js 等，`.intentflow/focus-open-mode/` 已有 requirement/design/later-on，缺 report.md）
  - 安装 opendsh-0.0.5.vsix 实测 webview 加固效果
- **长期备忘**：L01 聚焦插件挂载机制与本次 patch 修复相关（`.dsh/dsh.mcp.patch.yml` 既有 insert 机制），引用原文：`D:\w_dev\openDSH\.intentflow\focus-open-mode\later-on.md`（L01：DSH 聚焦插件本体的开发、构建与挂载）

## 6. 开发工作流反馈
- 本次是"环境诊断 + 代码修复"混合任务：诊断结论（页面旧快照 vs server 状态错位）直接决定了修复形态（cache-buster + 探测 + stale 刷新），流程上"先定位再动手"收益大
- **流程断点**：工作区存在未关账 feature（focus-open-mode）的代码与本次改动在 manager.js / test / package.json 中交织，文件级 git 提交无法干净分离 → 建议关账前先确认工作区归属，或每个 feature 独立提交后再开新 feature
- **skill 缺失**：无"环境诊断"类任务的模板（本次产出为诊断结论 + 修复代码 + 环境修复三部分，报告结构勉强套用）

## 7. 结论
- 当前状态：**可发布**（测试 85 全绿、0.0.5 vsix 已打包、dsh 环境实测健康）
- 建议下一步：安装 0.0.5 实测；随后为 focus-open-mode 补关账；长期按 later-on.md L01 推进聚焦插件本体
