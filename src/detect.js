/**
 * @intent
 * 把「自动检索」收敛为纯函数：解析设置、定位工作区、发现 MCP patch、解析 dsh 可执行、组装打开 URL。
 * dsh 定位优先级 = dshPath 设置 > npm 全局安装真实入口（node + bin.js）> PATH；全部落空返回 null 快速失败，绝不进入 npx 慢路径。
 * 聚焦打开方式（openWith=focus）由本模块合法化，并负责把 base URL 拆出「消息流 / 输入区」两个聚焦 URL，
 * 作为 opendsh 与 DSH 聚焦插件之间的 URL 参数契约（?focus=conversation / ?focus=composer）。
 *
 * 边界：任何检索失败都不抛异常——无工作区返回 null、无 patch 目录返回空数组、非法/缺失端口回退 3080、
 * 找不到 dsh 返回 null 由 manager 报错；resolveNpmGlobal 先走 APPDATA\npm 同步快速路径（零开销），
 * 未命中再经注入的 execFile 跑 npm prefix -g（模块级缓存）；node 路径经 resolveNode 探测——
 * execPath 本身是 node 才直接复用，否则回退 PATH/常见安装位/命令名（VS Code 扩展 host 的 execPath 是 Code.exe，不可作 node）；
 * 代码内无 URL 字面量，地址由 buildUrl/buildFocusUrls 组装；
 * buildFocusUrls 仅接受合法 host/port，输出 { conversation, composer } 两个同源 URL。
 *
 * 验收条件：
 * - resolveConfig 对缺失/非法 host/port 回退默认 127.0.0.1/3080，detached/showWindow/multipleTabs 非 true 一律回退 false，
 *   openWith 接受 tab/simpleBrowser/systemBrowser/focus（其余回退 tab）
 * - buildFocusUrls(host, port) 返回 { conversation, composer }，各含 ?focus= 参数且同源同端口
 * - buildFocusUrls 不抛异常，非法 host/port 时同样能拼出合法 URL 字符串
 * - resolvePatches 无 patch 目录返回 []，有则按文件名排序返回绝对路径，显式 patchFile 优先
 * - resolveDsh 优先级 = dshPath > npm 全局 > PATH，全部落空返回 null（不再 npx 兜底）
 * - resolveNpmGlobal 命中真实 lib/bin.js 返回 { command: node, prefixArgs: [binPath] }，未命中返回 null
 * - resolveNode 在 execPath 非 node（如 Code.exe）时回退 PATH/Program Files/命令名，绝不返回非 node 可执行
 * - buildUrl(host, port) 返回 http://host:port
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 3080;

// npm prefix -g 结果缓存：undefined = 未探测，string/null = 已探测（null 表示探测失败，不再重试）
let cachedNpmPrefix;

function resolveConfig(settings) {
  const s = settings || {};
  const host = typeof s.host === 'string' && s.host.trim() !== '' ? s.host.trim() : DEFAULT_HOST;
  const port = Number(s.port);
  const validPort = Number.isInteger(port) && port >= 1 && port <= 65535 ? port : DEFAULT_PORT;
  const dshPath = typeof s.dshPath === 'string' ? s.dshPath.trim() : '';
  const patchFile = typeof s.patchFile === 'string' ? s.patchFile.trim() : '';
  const detached = s.detached === true;
  const showWindow = s.showWindow === true;
  // 打开方式四选一：tab（内置单例标签页，默认）/ simpleBrowser（VS Code 内置 Simple Browser）/ systemBrowser（系统浏览器）
  // / focus（聚焦模式：对话进 VS Code 侧栏 + 输入区留主编辑区）
  const openWithRaw = typeof s.openWith === 'string' ? s.openWith : 'tab';
  const openWith =
    openWithRaw === 'simpleBrowser' || openWithRaw === 'systemBrowser' || openWithRaw === 'focus'
      ? openWithRaw
      : 'tab';
  const multipleTabs = s.multipleTabs === true;
  return { host, port: validPort, dshPath, patchFile, detached, showWindow, openWith, multipleTabs };
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

function runNpmPrefix(execFile) {
  if (typeof execFile !== 'function') return null;
  return new Promise((resolve) => {
    execFile('npm', ['prefix', '-g'], (err, stdout) => {
      if (err) return resolve(null);
      const prefix = String(stdout || '').trim();
      resolve(prefix || null);
    });
  });
}

async function resolveNpmGlobal(deps) {
  const d = deps || {};
  const isWin = typeof d.isWin === 'boolean' ? d.isWin : process.platform === 'win32';
  const env = d.env || process.env;
  const nodePath = resolveNode(d);

  // 快速路径：Windows npm 默认前缀 %APPDATA%\npm，同步 stat 零开销命中
  if (isWin && env.APPDATA) {
    const fast = path.join(env.APPDATA, 'npm', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js');
    try {
      if (fs.statSync(fast).isFile()) return { command: nodePath, prefixArgs: [fast] };
    } catch (err) {
      // not present in default npm prefix; fall through to npm prefix -g
    }
  }

  // 权威路径：npm prefix -g，仅首次 spawn，结果缓存到进程生命周期
  if (cachedNpmPrefix === undefined) {
    cachedNpmPrefix = await runNpmPrefix(d.execFile);
  }
  const prefix = cachedNpmPrefix;
  if (!prefix) return null;
  const bin = path.join(prefix, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js');
  try {
    if (fs.statSync(bin).isFile()) return { command: nodePath, prefixArgs: [bin] };
  } catch (err) {
    // global install not found under npm prefix
  }
  return null;
}

async function resolveDsh(config, deps) {
  const cfg = config || {};
  const d = deps || {};
  const isWin = typeof d.isWin === 'boolean' ? d.isWin : process.platform === 'win32';
  const pathEnv = d.pathEnv !== undefined ? d.pathEnv : (process.env && process.env.PATH) || '';
  if (cfg.dshPath) return { command: cfg.dshPath, prefixArgs: [] };
  const globalResolved = await resolveNpmGlobal(d);
  if (globalResolved) return globalResolved;
  const found = findOnPath('dsh', pathEnv, isWin);
  if (found) return { command: found, prefixArgs: [] };
  return null;
}

function buildUrl(host, port) {
  return `http://${host}:${port}`;
}

// 聚焦模式拆出两个独立承载面的 URL：conversation=消息流视图，composer=输入区视图。
// 这是 opendsh 与 DSH 聚焦插件之间的 URL 参数契约（DSH 侧按 ?focus= 渲染对应窗口并隐藏 sidebar）。
function buildFocusUrls(host, port) {
  const base = `http://${host}:${port}`;
  return {
    conversation: `${base}/?focus=conversation`,
    composer: `${base}/?focus=composer`,
  };
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
  buildFocusUrls,
  DEFAULT_HOST,
  DEFAULT_PORT,
};
