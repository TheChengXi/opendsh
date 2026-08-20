# 需求文档：DSH 升级兼容性修复

## 项目意图
修复 opendsh VS Code 扩展在 DSH 升级后出现的功能失效问题——静默启动失效（控制台窗口弹出）、打开位置失效（总是额外打开系统浏览器）、源码补丁失效（需重新运行 patch 脚本）。

## 功能清单
1. **[静默启动修复]**：DSH 服务启动时不弹出 Windows 控制台窗口（黑色命令行窗口）。
2. **[打开位置修复]**：DSH 页面按 `opendsh.openWith` 配置在指定位置打开，不额外打开系统浏览器。
3. **[补丁脚本重跑]**：`scripts\patch-dsh-windows-hide.mjs` 补丁脚本需要重新运行以修复 `dsh-subprocess-local` 模块。

## 核心功能

### 核心功能1：静默启动
- **能力**：系统能够 在 Windows 上静默启动 DSH 服务（不弹出控制台窗口），通过 `windowsHide: true` 参数实现。
- **业务价值**：用户体验流畅，启动 DSH 时不被黑色命令行窗口干扰。

### 核心功能2：打开位置控制
- **能力**：系统能够 按 `opendsh.openWith` 配置（tab/simpleBrowser/systemBrowser）在指定位置打开 DSH 页面，且不额外打开其他位置。
- **业务价值**：用户可自主选择 DSH 页面打开位置，配置生效且一致。

### 核心功能3：补丁脚本维护
- **能力**：系统能够 在 DSH 升级后通过重新运行 `patch-dsh-windows-hide.mjs` 脚本恢复静默启动功能。
- **业务价值**：DSH 升级覆盖 `node_modules` 后，用户可通过简单脚本重打补丁恢复功能。

## 业务规则

### 静默启动规则
- **场景**：用户启动 DSH 服务（通过 opendsh.open 命令或自动启动）。
- **行为**：在 Windows 上，DSH 子进程以 `windowsHide: true` 方式启动，不弹出控制台窗口。
- **异常处理**：若补丁未应用（`dsh-subprocess-local` 未被修改），控制台窗口会弹出；需重新运行补丁脚本。

### 打开位置规则
- **场景**：用户执行 `opendsh.open` 命令。
- **行为**：按 `opendsh.openWith` 配置打开：
  - `tab`（默认）：VS Code 内标签页
  - `simpleBrowser`：VS Code 内置浏览器
  - `systemBrowser`：系统浏览器
  - 不额外打开其他位置。
- **异常处理**：若配置值无效或创建面板失败，回退到系统浏览器（但不应额外打开）。

### 补丁脚本运行规则
- **场景**：DSH 升级/重装后 `node_modules` 被覆盖。
- **行为**：用户运行 `node scripts\patch-dsh-windows-hide.mjs` 重新应用补丁。
- **异常处理**：脚本幂等，已打补丁时输出 `[already patched]`；找不到目标文件时报错。

## 预设测试

### 前置条件
- Windows 操作系统
- DSH 已安装（`@deepseek-ai/dsh` 版本 0.1.0-rc.7 或更新）
- opendsh VS Code 扩展已安装
- 补丁脚本已运行（`node scripts\patch-dsh-windows-hide.mjs`）

### 测试步骤

1. **静默启动测试**
   **操作**：在 VS Code 中执行 `opendsh.open` 命令
   **预期结果**：DSH 服务启动，不弹出 Windows 控制台窗口（黑色命令行窗口）

2. **打开位置测试（tab 模式）**
   **操作**：设置 `opendsh.openWith` 为 `tab`，执行 `opendsh.open`
   **预期结果**：DSH 页面在 VS Code 内标签页打开，不额外打开系统浏览器

3. **打开位置测试（simpleBrowser 模式）**
   **操作**：设置 `opendsh.openWith` 为 `simpleBrowser`，执行 `opendsh.open`
   **预期结果**：DSH 页面在 VS Code 内置浏览器打开，不额外打开系统浏览器

4. **打开位置测试（systemBrowser 模式）**
   **操作**：设置 `opendsh.openWith` 为 `systemBrowser`，执行 `opendsh.open`
   **预期结果**：DSH 页面在系统浏览器打开，不额外打开其他位置

5. **补丁脚本测试**
   **操作**：运行 `node scripts\patch-dsh-windows-hide.mjs --check`
   **预期结果**：输出 `[already patched]` 表示补丁已应用

### 异常场景

- **补丁未应用**
  **操作**：运行 `node scripts\patch-dsh-windows-hide.mjs --check`
  **预期结果**：输出 `[needs patch]` 表示需要重新运行补丁脚本

- **DSH 升级后补丁失效**
  **操作**：升级 DSH 后运行 `node scripts\patch-dsh-windows-hide.mjs --check`
  **预期结果**：输出 `[needs patch]`，需重新运行脚本

## 边界收束

**此时必做**：
- 修复静默启动：确保 `windowsHide` 补丁应用到 `dsh-subprocess-local` 模块
- 修复打开位置：确保 `opendsh.openWith` 配置生效，不额外打开系统浏览器
- 重新运行补丁脚本：`node scripts\patch-dsh-windows-hide.mjs`

**此时不做**：
- 修改 DSH 源码（仅通过补丁脚本修改 `dsh-subprocess-local`）
- 添加新的打开方式（仅修复现有三种方式）
- 修改 VS Code 扩展的核心逻辑（仅修复配置读取和应用）

## 实现对齐

### 静默启动修复
- **实现路径**：通过 `patch-dsh-windows-hide.mjs` 脚本修改 `dsh-subprocess-local/lib/index.js`，在 `spawn()` 调用中添加 `windowsHide: platform === "win32"` 参数。
- **推导出的约束**：DSH 升级会覆盖 `node_modules`，需重新运行补丁脚本；补丁脚本需幂等。
- **design 决策**：无。

### 打开位置修复
- **实现路径**：在 `buildDshArgs()` 函数中添加 `--no-open` 参数，禁用 DSH web 应用的自动打开浏览器行为。DSH web 应用默认 `openBrowser: true`，会自动打开系统浏览器；通过 `--no-open` 参数可禁用此行为，由 opendsh 扩展控制打开方式。
- **推导出的约束**：`openWith` 接受 `tab`/`simpleBrowser`/`systemBrowser` 三个值，无效值回退 `tab`；DSH 的 `--no-open` 参数可禁用自动打开浏览器。
- **design 决策**：无。

### 补丁脚本维护
- **实现路径**：`patch-dsh-windows-hide.mjs` 脚本定位 `dsh-subprocess-local/lib/index.js`，查找 `detached: platform !== "win32"` 行，替换为两行（原行 + `windowsHide: platform === "win32"`）。
- **推导出的约束**：脚本需支持 `--check`（只查状态）和 `--dsh-root`（指定安装根）；目标文件路径可能因安装方式不同而变化。
- **design 决策**：无。
