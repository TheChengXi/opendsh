#!/usr/bin/env node
/**
 * @intent
 * 可重复执行、幂等的 DSH Windows 子进程窗口补丁：定位 @deepseek-ai/dsh-subprocess-local 的 spawnSubprocess 里的 spawn()，在 detached 旁补 windowsHide: platform === "win32"（CREATE_NO_WINDOW），消除 dsh 服务静默启动时每次 spawn 子进程弹出的 node 控制台窗口。不改执行模型、不剥离 Windows ACL 隔离沙箱；仅 win32 生效。DSH 升级/重装会覆盖 node_modules，重跑本脚本即可重打。支持 --check（只查状态）与 --dsh-root 指定安装根。零第三方依赖，纯 node:fs 文本替换。
 */


'use strict';

import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { basename, join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const WINDOWS_HIDE_PATCH = 'windowsHide: platform === "win32"';

function err(msg) {
  process.stderr.write(`patch-dsh-windows-hide: ${msg}\n`);
  process.exit(1);
}

/** 解析 dsh 包根：支持 --dsh-root、APPDATA\npm 全局、require 查找。 */
function resolveDshRoot(cliRoot) {
  if (cliRoot) return cliRoot;
  const candidates = [];
  const appData = process.env.APPDATA || (process.platform === 'win32' ? join(homedir(), 'AppData', 'Roaming') : null);
  if (appData) candidates.push(join(appData, 'npm', 'node_modules', '@deepseek-ai', 'dsh'));
  candidates.push(join(dirname(__dirname), 'node_modules', '@deepseek-ai', 'dsh'));
  const require = createRequire(pathToFileURL(__filename));
  try {
    candidates.push(require.resolve('@deepseek-ai/dsh/package.json').replace(/[\\/]package\.json$/, ''));
  } catch {}
  for (const c of candidates) {
    try {
      if (statSync(c).isDirectory()) return c;
    } catch {}
  }
  err(`dsh package not found (tried: ${candidates.join(', ')}). Pass --dsh-root.`);
}

/** 定位 dsh-subprocess-local 的 lib/index.js（含 spawnSubprocess 的 bundle）。 */
function resolveTarget(dshRoot) {
  const candidates = [
    join(dshRoot, '..', '..', 'dsh-subprocess-local', 'lib', 'index.js'), // .../npm/node_modules/@deepseek-ai/dsh-subprocess-local
    join(dirname(dshRoot), 'dsh-subprocess-local', 'lib', 'index.js'),
  ];
  for (const c of candidates) {
    try {
      if (statSync(c).isFile()) return c;
    } catch {}
  }
  const profileRoot = join(homedir(), '.dsh', 'profiles', 'node_modules', '@deepseek-ai', 'dsh-subprocess-local', 'lib', 'index.js');
  try {
    if (statSync(profileRoot).isFile()) return profileRoot;
  } catch {}
  err(`dsh-subprocess-local/lib/index.js not found under ${dshRoot}.`);
}

/** 精确定位 spawnSubprocess 的 spawn 选项对象里的 detached 行并返回正则所需上下文。 */
const DETACHED_LINE = /^([ \t]*)detached: platform !== "win32"(,)?[ \t]*$/m;

function patchTarget(file, opts) {
  let src;
  try {
    src = readFileSync(file, 'utf8');
  } catch (e) {
    err(`cannot read ${file}: ${e.message}`);
  }
  if (src.includes(WINDOWS_HIDE_PATCH)) {
    if (opts.check) process.stdout.write(`[already patched] ${file}\n`);
    else process.stdout.write(`[ok, already patched] ${file}\n`);
    return src;
  }
  if (!DETACHED_LINE.test(src)) err(`cannot locate "detached: platform !== \\"win32\\"" line in ${file}; DSH may have changed.`);
  // detached 行替换为两行：原行补逗号 + windowsHide。win32 下 detached=false 与 windowsHide=true 并存合法。
  const patched = src.replace(
    DETACHED_LINE,
    (_m, indent) => `${indent}detached: platform !== "win32",\n${indent}windowsHide: platform === "win32"`
  );
  if (opts.check) {
    process.stdout.write(`[needs patch] ${file}\n`);
    return src;
  }
  writeFileSync(file, patched, 'utf8');
  process.stdout.write(`[patched] ${file}\n`);
  return patched;
}

function main() {
  const args = process.argv.slice(2);
  const opts = { check: false, dshRoot: null };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--check') opts.check = true;
    else if (args[i] === '--dsh-root') opts.dshRoot = args[++i];
  }
  const root = resolveDshRoot(opts.dshRoot);
  const file = resolveTarget(root);
  process.stdout.write(`target: ${file}\n`);
  patchTarget(file, opts);
}

main();
