/**
 * @intent
 * 跨平台 DSH 进程与端口适配：拼 spawn 参数、spawn/kill 子进程、探测端口占用、等待端口就绪。
 *
 * 边界：spawn 用 detached + stdio:ignore + windowsHide 使服务独立于编辑器存活；Windows 经 cmd.exe
 * 走 .cmd shim，POSIX 直接 spawn；kill 在 Windows 用 taskkill /T /F 树杀，POSIX 用 child.kill。
 *
 * 验收条件：
 * - buildDshArgs 顺序 = [prefix..., web, --patch p..., --host host, --port port]（--patch 必须在 --host/--port 前，否则 dsh 报 unknown option）
 * - isPortInUse 对真实监听端口返回 true，空闲端口返回 false
 * - waitForPort 端口在超时内就绪返回 true，超时返回 false
 * - spawnDsh 在 win 走 cmd.exe /d /s /c、非 win 直接 spawn，且传 detached/windowsHide/stdio:ignore
 * - killDsh 在 win 拼 taskkill /pid <pid> /T /F，非 win 调 child.kill
 */

'use strict';

const childProcess = require('node:child_process');
const net = require('node:net');

function buildDshArgs(resolved, opts) {
  const r = resolved || {};
  const o = opts || {};
  const patches = Array.isArray(o.patches) ? o.patches : [];
  const args = [];
  if (Array.isArray(r.prefixArgs)) args.push(...r.prefixArgs);
  args.push('web');
  for (const p of patches) args.push('--patch', p);
  args.push('--host', o.host, '--port', String(o.port));
  return args;
}

function spawnDsh(resolved, opts, spawnFn) {
  const spawn = spawnFn || childProcess.spawn;
  const o = opts || {};
  const args = buildDshArgs(resolved, o);
  const isWin = (o.platform || process.platform) === 'win32';
  const child = spawn(resolved.command, args, {
    cwd: o.cwd,
    shell: isWin,
    detached: true,
    stdio: 'ignore',
    windowsHide: isWin,
  });
  if (child && typeof child.unref === 'function') child.unref();
  return child;
}

function isPortInUse(host, port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    let settled = false;
    const done = (val) => {
      if (settled) return;
      settled = true;
      resolve(val);
    };
    socket.once('connect', () => {
      socket.destroy();
      done(true);
    });
    socket.once('error', () => {
      socket.destroy();
      done(false);
    });
    socket.setTimeout(500, () => {
      socket.destroy();
      done(false);
    });
  });
}

function waitForPort(host, port, opts) {
  const o = opts || {};
  const timeoutMs = o.timeoutMs !== undefined ? o.timeoutMs : 15000;
  const intervalMs = o.intervalMs !== undefined ? o.intervalMs : 500;
  const probe = o.probe || isPortInUse;
  const sleep = o.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const deadline = Date.now() + timeoutMs;
  const poll = async () => {
    for (;;) {
      if (await probe(host, port)) return true;
      if (Date.now() >= deadline) return false;
      await sleep(intervalMs);
    }
  };
  return poll();
}

function killDsh(child, deps) {
  const d = deps || {};
  if (!child || child.killed) return Promise.resolve(false);
  const isWin = (d.platform || process.platform) === 'win32';
  if (isWin) {
    const exec = d.execFile || childProcess.execFile;
    return new Promise((resolve) => {
      exec('taskkill', ['/pid', String(child.pid), '/T', '/F'], (err) => resolve(!err));
    });
  }
  return new Promise((resolve) => {
    child.once('exit', () => resolve(true));
    try {
      child.kill('SIGTERM');
    } catch (err) {
      resolve(false);
    }
  });
}

module.exports = {
  buildDshArgs,
  spawnDsh,
  isPortInUse,
  waitForPort,
  killDsh,
};
