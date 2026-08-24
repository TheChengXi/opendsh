/**
 * @intent
 * 跨平台 DSH 进程与端口适配：拼 spawn 参数、spawn/kill 子进程、探测端口占用、等待端口就绪、HTTP 探测端口归属。
 *
 * 边界：spawnDsh 静默 spawn（detached + stdio:[ignore,ignore,pipe] + windowsHide，stderr 可诊断）；spawnDshVisible 桌面窗口 spawn（stdio:inherit + detached:false，输出直写窗口不经过 pipe）；
 * direct 模式（node + bin.js 真实入口）直接 spawn 不经 cmd shim，仅 PATH 兜底命中的 .cmd 才走 shell；
 * kill 在 Windows 用 taskkill /T /F 树杀，POSIX 用 child.kill；
 * httpProbe 以 2xx + body 含 __DSH_BOOT__ 判定端口归属 dsh，用于区分「外部手动起的 dsh」与「其他程序占用」。
 *
 * 验收条件：
 * - buildDshArgs 顺序 = [prefix..., web, --patch p..., --host host, --port port]（--patch 必须在 --host/--port 前，否则 dsh 报 unknown option）
 * - isPortInUse 对真实监听端口返回 true，空闲端口返回 false（未监听探测超时 100ms）
 * - waitForPort 端口在超时内就绪返回 true，超时返回 false
 * - spawnDsh 统一静默（stdio pipe stderr + windowsHide + detached）；spawnDshVisible 桌面窗口（stdio inherit + detached false）；direct 模式 shell:false；.cmd 兜底模式 shell:true
 * - httpProbe 对 dsh 特征响应返回 true，非 dsh 响应/连接失败返回 false
 * - killDsh 在 win 拼 taskkill /pid <pid> /T /F，非 win 调 child.kill；killPid 按纯 pid 杀（无 child 对象，POSIX 用 process.kill）
 * - buildTerminalCommand 输出可交给 VSCode 集成终端执行的单行命令（command + 转义后参数），terminal 模式专用
 */

'use strict';

const childProcess = require('node:child_process');
const net = require('node:net');
const http = require('node:http');

function buildDshArgs(resolved, opts) {
  const r = resolved || {};
  const o = opts || {};
  const patches = Array.isArray(o.patches) ? o.patches : [];
  const args = [];
  if (Array.isArray(r.prefixArgs)) args.push(...r.prefixArgs);
  args.push('web');
  for (const p of patches) args.push('--patch', p);
  args.push('--host', o.host, '--port', String(o.port));
  // 禁用 DSH 自动打开浏览器：由 opendsh 扩展控制打开方式，不由 DSH 自身决定
  args.push('--no-open');
  return args;
}

function spawnDsh(resolved, opts, spawnFn) {
  const spawn = spawnFn || childProcess.spawn;
  const o = opts || {};
  const args = buildDshArgs(resolved, o);
  const isWin = (o.platform || process.platform) === 'win32';
  // 仅 .cmd/.bat 需要 shell（npm shim 兜底）；node + bin.js 直接 spawn，绕开 cmd 嵌套
  const needShell = isWin && /\.(cmd|bat)$/i.test(resolved.command || '');
  const child = spawn(resolved.command, args, {
    cwd: o.cwd,
    shell: needShell,
    detached: true,
    stdio: ['ignore', 'ignore', 'pipe'],
    windowsHide: isWin,
  });
  if (child && typeof child.unref === 'function') child.unref();
  return child;
}

// 桌面可见控制台窗口启动（window 模式，随 VS Code 关闭）：stdio inherit 让 Windows 分配新控制台窗口，
// 输出直写窗口不走 stderr pipe（故 child.stderr 为 null，manager 不 attachStderr）。
function spawnDshVisible(resolved, opts, spawnFn) {
  const spawn = spawnFn || childProcess.spawn;
  const o = opts || {};
  const args = buildDshArgs(resolved, o);
  const isWin = (o.platform || process.platform) === 'win32';
  // 仅 .cmd/.bat 需要 shell（npm shim 兜底）；node + bin.js 直接 spawn，绕开 cmd 嵌套
  const needShell = isWin && /\.(cmd|bat)$/i.test(resolved.command || '');
  return spawn(resolved.command, args, {
    cwd: o.cwd,
    shell: needShell,
    detached: false,
    stdio: 'inherit',
  });
}

function quoteWinArg(s) {
  const str = String(s);
  if (!/[\s"]/.test(str)) return str;
  return '"' + str.replace(/"/g, '\\"') + '"';
}

// 拼接可交给 VS Code 集成终端执行的单行命令（command + buildDshArgs，含空格/引号时逐个包裹）。
function buildTerminalCommand(resolved, opts) {
  const r = resolved || {};
  return [r.command, ...buildDshArgs(r, opts)].map(quoteWinArg).join(' ');
}

function buildWmiScript(resolved, opts) {
  const o = opts || {};
  const args = buildDshArgs(resolved, o);
  const cmdLine = [resolved.command, ...args].map(quoteWinArg).join(' ');
  const cwd = o.cwd || '';
  const showWindow = o.showWindow === true ? 1 : 0;
  const esc = (s) => String(s).replace(/'/g, "''");
  return [
    'Add-Type -AssemblyName System.Management',
    "$s = (New-Object System.Management.ManagementClass('Win32_ProcessStartup')).CreateInstance()",
    "$s['ShowWindow'] = [uint32]" + showWindow,
    "$m = New-Object System.Management.ManagementClass('Win32_Process')",
    "$i = $m.GetMethodParameters('Create')",
    "$i['CommandLine'] = '" + esc(cmdLine) + "'",
    "$i['CurrentDirectory'] = '" + esc(cwd) + "'",
    "$i['ProcessStartupInformation'] = $s",
    "$o = $m.InvokeMethod('Create', $i, $null)",
    "if ($o['ReturnValue'] -ne 0) { throw ('WMI Create failed: ' + $o['ReturnValue']) }",
    "Write-Output $o['ProcessId']",
  ].join('; ');
}

function spawnDshStandalone(resolved, opts, execFileFn) {
  const execFile = execFileFn || childProcess.execFile;
  const o = opts || {};
  const script = buildWmiScript(resolved, o);
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded],
      { timeout: o.wmiTimeoutMs !== undefined ? o.wmiTimeoutMs : 15000 },
      (err, stdout) => {
        if (err) return reject(err);
        const pid = Number(String(stdout || '').trim());
        if (!Number.isInteger(pid) || pid <= 0) {
          return reject(new Error('WMI did not return a valid pid'));
        }
        resolve({ pid });
      }
    );
  });
}

async function spawnStandalone(resolved, opts, spawnFn, execFileFn) {
  const o = opts || {};
  const isWin = (o.platform || process.platform) === 'win32';
  if (isWin) {
    return spawnDshStandalone(resolved, o, execFileFn);
  }
  // POSIX：detached spawn 天然独立
  const child = spawnDsh(resolved, o, spawnFn);
  return { pid: child.pid };
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
    socket.setTimeout(100, () => {
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

function httpProbe(host, port, opts) {
  const o = opts || {};
  const timeoutMs = o.timeoutMs !== undefined ? o.timeoutMs : 1000;
  const get = o.get || http.get;
  return new Promise((resolve) => {
    const req = get({ host, port, path: '/', timeout: timeoutMs }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => {
        const isDsh = res.statusCode >= 200 && res.statusCode < 300 && body.includes('__DSH_BOOT__');
        resolve(isDsh);
      });
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
}

function killPid(pid, deps) {
  const d = deps || {};
  if (!Number.isInteger(pid) || pid <= 0) return Promise.resolve(false);
  const isWin = (d.platform || process.platform) === 'win32';
  if (isWin) {
    const exec = d.execFile || childProcess.execFile;
    return new Promise((resolve) => {
      exec('taskkill', ['/pid', String(pid), '/T', '/F'], (err) => resolve(!err));
    });
  }
  return new Promise((resolve) => {
    try {
      process.kill(pid, 'SIGTERM');
      resolve(true);
    } catch (err) {
      resolve(false);
    }
  });
}

function killDsh(child, deps) {
  if (!child || child.killed) return Promise.resolve(false);
  const d = deps || {};
  if ((d.platform || process.platform) === 'win32') {
    return killPid(child.pid, d);
  }
  // 伪 child（WMI/POSIX 独立启动仅持有 pid）无 kill 方法，按 pid 发信号
  if (typeof child.kill !== 'function') {
    return killPid(child.pid, d);
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
  spawnDshVisible,
  quoteWinArg,
  buildTerminalCommand,
  buildWmiScript,
  spawnDshStandalone,
  spawnStandalone,
  isPortInUse,
  waitForPort,
  httpProbe,
  killPid,
  killDsh,
};
