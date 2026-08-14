/**
 * @intent
 * 把「自动检索」收敛为纯函数：解析设置、定位工作区、发现 MCP patch、解析 dsh 可执行、组装打开 URL。
 *
 * 边界：任何检索失败都不抛异常——无工作区返回 null、无 patch 目录返回空数组、非法/缺失端口回退 3080、
 * 找不到 dsh 走 npx @deepseek-ai/dsh 兜底；代码内无 URL 字面量，地址由 buildUrl 组装。
 *
 * 验收条件：
 * - resolveConfig 对缺失/非法 host/port 回退默认 127.0.0.1/3080
 * - resolvePatches 无 patch 目录返回 []，有则按文件名排序返回绝对路径，显式 patchFile 优先
 * - resolveDsh 优先级 = dshPath > PATH 的 dsh > npx @deepseek-ai/dsh
 * - buildUrl(host, port) 返回 http://host:port
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 3080;

function resolveConfig(settings) {
  const s = settings || {};
  const host = typeof s.host === 'string' && s.host.trim() !== '' ? s.host.trim() : DEFAULT_HOST;
  const port = Number(s.port);
  const validPort = Number.isInteger(port) && port >= 1 && port <= 65535 ? port : DEFAULT_PORT;
  const dshPath = typeof s.dshPath === 'string' ? s.dshPath.trim() : '';
  const patchFile = typeof s.patchFile === 'string' ? s.patchFile.trim() : '';
  return { host, port: validPort, dshPath, patchFile };
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

function resolveDsh(config, deps) {
  const cfg = config || {};
  const d = deps || {};
  const isWin = typeof d.isWin === 'boolean' ? d.isWin : process.platform === 'win32';
  const pathEnv = d.pathEnv !== undefined ? d.pathEnv : (process.env && process.env.PATH) || '';
  if (cfg.dshPath) return { command: cfg.dshPath, prefixArgs: [] };
  const found = findOnPath('dsh', pathEnv, isWin);
  if (found) return { command: found, prefixArgs: [] };
  return { command: 'npx', prefixArgs: ['@deepseek-ai/dsh'] };
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
  resolveDsh,
  buildUrl,
  DEFAULT_HOST,
  DEFAULT_PORT,
};
