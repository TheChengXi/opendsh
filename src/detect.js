/**
 * @intent
 * 把「自动检索」收敛为纯函数：解析设置、定位工作区、发现 MCP patch、解析 dsh 可执行、组装打开 URL。
 * dsh 定位优先级 = dshPath 设置 > PATH 的 dsh 命令（npm shim）> npm 全局真实入口（读 package.json bin 字段定位）；全部落空返回 null 快速失败，绝不进入 npx 慢路径。
 * 本扩展是薄壳启动器：打开方式仅 openWith 三值（tab/simpleBrowser/systemBrowser），由打开入口据此分叉；
 * URL 组装只有 buildUrl（http://host:port），不承担 ?focus= 等任何界面聚焦契约。
 *
 * 边界：任何检索失败都不抛异常——无工作区返回 null、无 patch 目录返回空数组、非法/缺失端口回退 3080、
 * 找不到 dsh 返回 null 由 manager 报错；launchMode 为启动模式枚举（integrated/window/hidden/window-keepalive/hidden-keepalive，非法一律回退默认 integrated），windowsHidePatch 非 true 一律回退 false（实验版补丁开关）；
 * resolveNpmGlobal 仅 Windows APPDATA\npm 定位 npm 全局根并读 @deepseek-ai/dsh/package.json 的 bin 字段解析真实入口（不再硬编码 lib/bin.js；POSIX 由 PATH 的 dsh 可执行脚本覆盖，返回 null）；
 * node 路径经 resolveNode 探测——execPath 本身是 node 才直接复用，否则回退 PATH/常见安装位/命令名（VS Code 扩展 host 的 execPath 是 Code.exe，不可作 node）；
 * 代码内无 URL 字面量，地址由 buildUrl 组装。
 *
 * 验收条件：
 * - resolveConfig 对缺失/非法 host/port 回退默认 127.0.0.1/3080，multipleTabs/windowsHidePatch 非 true 一律回退 false，
 *   launchMode 仅 5 个合法值（integrated/window/hidden/window-keepalive/hidden-keepalive），其余一律回退默认 integrated；
 *   openWith 接受 tab/simpleBrowser/systemBrowser（其余回退 tab，含旧 focus 值）
 * - resolvePatches 无 patch 目录返回 []，有则按文件名排序返回绝对路径，显式 patchFile 优先
 * - resolveDsh 优先级 = dshPath > PATH > npm 全局，全部落空返回 null（不再 npx 兜底）
 * - resolveNpmGlobal 命中则按 package.json bin 字段返回 { command: node, prefixArgs: [真实入口] }，未命中/非 Windows 返回 null
 * - resolveNode 在 execPath 非 node（如 Code.exe）时回退 PATH/Program Files/命令名，绝不返回非 node 可执行
 * - buildUrl(host, port) 返回 http://host:port
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 3080;
const LAUNCH_MODES = ['integrated', 'window', 'hidden', 'window-keepalive', 'hidden-keepalive'];

function resolveConfig(settings) {
  const s = settings || {};
  const host = typeof s.host === 'string' && s.host.trim() !== '' ? s.host.trim() : DEFAULT_HOST;
  const port = Number(s.port);
  const validPort = Number.isInteger(port) && port >= 1 && port <= 65535 ? port : DEFAULT_PORT;
  const dshPath = typeof s.dshPath === 'string' ? s.dshPath.trim() : '';
  const patchFile = typeof s.patchFile === 'string' ? s.patchFile.trim() : '';
  // 启动模式枚举（载体 × 存活的有效组合）：仅 5 个合法值，其余（含旧 showWindow/detached/experimentalSilentKeepAlive 遗留值）回退默认 integrated
  const launchMode = LAUNCH_MODES.includes(s.launchMode) ? s.launchMode : 'integrated';
  const windowsHidePatch = s.windowsHidePatch === true;
  // webview 内访问 DSH 用的主机名：默认同 host；可单独设为别名（如 dsh.local）绕开 VS Code 对 localhost 的 service-worker 拦截，
  // 不影响服务管理（isPortInUse/spawn 仍用 host）
  const webviewHost = typeof s.webviewHost === 'string' && s.webviewHost.trim() !== '' ? s.webviewHost.trim() : host;
  // 打开方式三选一：tab（内置单例标签页，默认）/ simpleBrowser（VS Code 内置 Simple Browser）/ systemBrowser（系统浏览器）
  // focus（聚焦模式）已移除，旧值回退 tab
  const openWithRaw = typeof s.openWith === 'string' ? s.openWith : 'tab';
  const openWith =
    openWithRaw === 'simpleBrowser' || openWithRaw === 'systemBrowser'
      ? openWithRaw
      : 'tab';
  const multipleTabs = s.multipleTabs === true;
  return { host, webviewHost, port: validPort, dshPath, patchFile, launchMode, windowsHidePatch, openWith, multipleTabs };
}

function resolveWorkspace(folders) {
  const first = (folders || [])[0];
  if (first && first.uri && typeof first.uri.fsPath === 'string' && first.uri.fsPath !== '') {
    return first.uri.fsPath;
  }
  return null;
}

function findPatchFiles(root) {
  if (!root) return [];
  const dir = path.join(root, '.dsh');
  let entries;
  try {
    entries = fs.readdirSync(dir);
  } catch (err) {
    return [];
  }
  return entries
    .filter((name) => name.endsWith('.patch.yml'))
    .map((name) => path.join(dir, name))
    .sort();
}

function resolvePatches(config, workspace) {
  const cfg = config || {};
  if (cfg.patchFile) {
    const abs = path.isAbsolute(cfg.patchFile)
      ? cfg.patchFile
      : path.join(workspace || '', cfg.patchFile);
    return [abs];
  }
  return findPatchFiles(workspace);
}

function findOnPath(cmd, pathEnv, isWin) {
  const sep = isWin ? ';' : ':';
  const exts = isWin ? ['', '.cmd', '.exe', '.bat'] : [''];
  const dirs = (pathEnv || '').split(sep);
  for (const dir of dirs) {
    if (!dir) continue;
    for (const ext of exts) {
      const candidate = path.join(dir, cmd + ext);
      try {
        if (fs.statSync(candidate).isFile()) return candidate;
      } catch (err) {
        // not present in this directory; keep scanning
      }
    }
  }
  return null;
}

function resolveNode(deps) {
  const d = deps || {};
  const isWin = typeof d.isWin === 'boolean' ? d.isWin : process.platform === 'win32';
  const pathEnv = d.pathEnv !== undefined ? d.pathEnv : (process.env && process.env.PATH) || '';
  const execPath = d.nodePath || d.execPath || process.execPath;
  const env = d.env || process.env;

  // 1) execPath 本身就是 node → 直接复用（普通 node 进程、测试注入 nodePath 走这里）
  if (execPath) {
    const base = path.basename(String(execPath)).toLowerCase();
    if (base === 'node' || base === 'node.exe') return execPath;
  }
  // 2) PATH 查找 node（.exe 优先）
  const found = findOnPath('node', pathEnv, isWin);
  if (found) return found;
  // 3) 常见安装位置（Windows）
  if (isWin) {
    const roots = [env.ProgramFiles, env['ProgramFiles(x86)']].filter(Boolean);
    for (const root of roots) {
      const candidate = path.join(root, 'nodejs', 'node.exe');
      try {
        if (fs.statSync(candidate).isFile()) return candidate;
      } catch (err) {
        // not installed at this root
      }
    }
  }
  // 4) 最后手段：'node' 命令名，由 CreateProcess 按 PATH/PATHEXT 解析
  return 'node';
}

function resolveNpmGlobal(deps) {
  const d = deps || {};
  const isWin = typeof d.isWin === 'boolean' ? d.isWin : process.platform === 'win32';
  const env = d.env || process.env;
  // 仅 Windows 走 npm 全局真实入口兜底（绕 .cmd shim）；POSIX 由 PATH 的 dsh 可执行脚本覆盖
  if (!isWin || !env.APPDATA) return null;
  const pkgDir = path.join(env.APPDATA, 'npm', 'node_modules', '@deepseek-ai', 'dsh');
  let pkg;
  try {
    pkg = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8'));
  } catch (err) {
    return null;
  }
  // 按 package.json 的 bin 字段定位真实入口（bin 可为字符串或 { dsh: <path> }），不再硬编码 lib/bin.js
  const binRel = pkg && typeof pkg.bin === 'string'
    ? pkg.bin
    : pkg && pkg.bin && typeof pkg.bin.dsh === 'string'
      ? pkg.bin.dsh
      : null;
  if (!binRel) return null;
  const binAbs = path.join(pkgDir, binRel);
  try {
    if (fs.statSync(binAbs).isFile()) return { command: resolveNode(d), prefixArgs: [binAbs] };
  } catch (err) {
    // entry not present at the resolved bin path
  }
  return null;
}

async function resolveDsh(config, deps) {
  const cfg = config || {};
  const d = deps || {};
  const isWin = typeof d.isWin === 'boolean' ? d.isWin : process.platform === 'win32';
  const pathEnv = d.pathEnv !== undefined ? d.pathEnv : (process.env && process.env.PATH) || '';
  if (cfg.dshPath) return { command: cfg.dshPath, prefixArgs: [] };
  // 1) PATH 的 dsh 命令（npm shim，恒指向 package.json bin 声明的真实入口）
  const found = findOnPath('dsh', pathEnv, isWin);
  if (found) return { command: found, prefixArgs: [] };
  // 2) npm 全局真实入口（读 package.json bin 字段，绕 .cmd shim）
  return resolveNpmGlobal(d);
}

function buildUrl(host, port) {
  return `http://${host}:${port}`;
}

module.exports = {
  resolveConfig,
  resolveWorkspace,
  findPatchFiles,
  resolvePatches,
  findOnPath,
  resolveNode,
  resolveNpmGlobal,
  resolveDsh,
  buildUrl,
  DEFAULT_HOST,
  DEFAULT_PORT,
};
