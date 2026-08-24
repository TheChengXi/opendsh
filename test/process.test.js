/**
 * @intent
 * process.js 的 node:test 单测，覆盖参数拼接、端口探测（真实 socket）、spawn 静默/桌面窗口分支、buildTerminalCommand、
 * HTTP 归属探测、kill 树杀参数。
 *
 * 验收条件：node --test 全绿，只 mock spawn / taskkill / execFile 系统边界，不 mock 内部协作者；
 * spawnDsh 统一静默（stdio pipe + windowsHide + detached）；spawnDshVisible 桌面窗口（stdio inherit + detached false）；
 * buildTerminalCommand 输出单行命令串。
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const net = require('node:net');
const http = require('node:http');
const { EventEmitter } = require('node:events');
const proc = require('../src/process');

test('buildDshArgs builds ordered args with prefix and patches', () => {
  const args = proc.buildDshArgs(
    { command: 'dsh', prefixArgs: [] },
    { host: '127.0.0.1', port: 3080, patches: ['a.yml', 'b.yml'] }
  );
  assert.deepStrictEqual(args, [
    'web',
    '--patch',
    'a.yml',
    '--patch',
    'b.yml',
    '--host',
    '127.0.0.1',
    '--port',
    '3080',
    '--no-open',
  ]);
});

test('buildDshArgs prepends npx prefix', () => {
  const args = proc.buildDshArgs(
    { command: 'npx', prefixArgs: ['@deepseek-ai/dsh'] },
    { host: '127.0.0.1', port: 3080, patches: [] }
  );
  assert.deepStrictEqual(args, ['@deepseek-ai/dsh', 'web', '--host', '127.0.0.1', '--port', '3080', '--no-open']);
});

test('spawnDsh non-win spawns directly without shell', () => {
  let captured = null;
  const fakeSpawn = (cmd, args, opts) => {
    captured = { cmd, args, opts };
    return { pid: 1, unref() {} };
  };
  proc.spawnDsh(
    { command: 'dsh', prefixArgs: [] },
    { platform: 'linux', host: '127.0.0.1', port: 3080, patches: [], cwd: '/ws' },
    fakeSpawn
  );
  assert.strictEqual(captured.cmd, 'dsh');
  assert.deepStrictEqual(captured.args, ['web', '--host', '127.0.0.1', '--port', '3080', '--no-open']);
  assert.strictEqual(captured.opts.shell, false);
  assert.strictEqual(captured.opts.detached, true);
  assert.deepStrictEqual(captured.opts.stdio, ['ignore', 'ignore', 'pipe']);
  assert.strictEqual(captured.opts.cwd, '/ws');
});

test('spawnDsh win .cmd fallback spawns with shell true and windowsHide', () => {
  let captured = null;
  const fakeSpawn = (cmd, args, opts) => {
    captured = { cmd, args, opts };
    return { pid: 2, unref() {} };
  };
  proc.spawnDsh(
    { command: 'C:/npm/dsh.cmd', prefixArgs: [] },
    { platform: 'win32', host: '127.0.0.1', port: 8080, patches: ['C:/ws/.dsh/a.patch.yml'], cwd: 'C:/ws' },
    fakeSpawn
  );
  assert.strictEqual(captured.cmd, 'C:/npm/dsh.cmd');
  assert.deepStrictEqual(captured.args, [
    'web',
    '--patch',
    'C:/ws/.dsh/a.patch.yml',
    '--host',
    '127.0.0.1',
    '--port',
    '8080',
    '--no-open',
  ]);
  assert.strictEqual(captured.opts.shell, true);
  assert.strictEqual(captured.opts.windowsHide, true);
  assert.strictEqual(captured.opts.detached, true);
  assert.deepStrictEqual(captured.opts.stdio, ['ignore', 'ignore', 'pipe']);
});

test('spawnDsh win direct (node + bin.js) spawns without shell', () => {
  let captured = null;
  const fakeSpawn = (cmd, args, opts) => {
    captured = { cmd, args, opts };
    return { pid: 3, unref() {} };
  };
  proc.spawnDsh(
    { command: 'C:/node/node.exe', prefixArgs: ['C:/npm/node_modules/@deepseek-ai/dsh/lib/bin.js'] },
    { platform: 'win32', host: '127.0.0.1', port: 8080, patches: [], cwd: 'C:/ws' },
    fakeSpawn
  );
  assert.strictEqual(captured.cmd, 'C:/node/node.exe');
  assert.deepStrictEqual(captured.args, [
    'C:/npm/node_modules/@deepseek-ai/dsh/lib/bin.js',
    'web',
    '--host',
    '127.0.0.1',
    '--port',
    '8080',
    '--no-open',
  ]);
  assert.strictEqual(captured.opts.shell, false);
  assert.strictEqual(captured.opts.windowsHide, true);
  assert.strictEqual(captured.opts.detached, true);
  assert.deepStrictEqual(captured.opts.stdio, ['ignore', 'ignore', 'pipe']);
});

test('spawnDshVisible win spawns with stdio inherit and not detached', () => {
  let captured = null;
  const fakeSpawn = (cmd, args, opts) => {
    captured = { cmd, args, opts };
    return { pid: 4 };
  };
  proc.spawnDshVisible(
    { command: 'C:/node/node.exe', prefixArgs: ['C:/npm/node_modules/@deepseek-ai/dsh/lib/bin.js'] },
    { platform: 'win32', host: '127.0.0.1', port: 8080, patches: [], cwd: 'C:/ws' },
    fakeSpawn
  );
  assert.strictEqual(captured.cmd, 'C:/node/node.exe');
  assert.strictEqual(captured.opts.shell, false);
  assert.strictEqual(captured.opts.detached, false);
  assert.strictEqual(captured.opts.stdio, 'inherit');
  assert.strictEqual(captured.opts.windowsHide, undefined);
});

test('isPortInUse true on listening port, false on free port', async () => {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const busyPort = server.address().port;
  try {
    assert.strictEqual(await proc.isPortInUse('127.0.0.1', busyPort), true);
  } finally {
    server.close();
  }

  const tmp = net.createServer();
  await new Promise((resolve) => tmp.listen(0, '127.0.0.1', resolve));
  const freePort = tmp.address().port;
  await new Promise((resolve) => tmp.close(resolve));
  assert.strictEqual(await proc.isPortInUse('127.0.0.1', freePort), false);
});

test('waitForPort resolves true when port already listening', async () => {
  const ok = await proc.waitForPort('127.0.0.1', 3080, {
    timeoutMs: 100,
    intervalMs: 5,
    probe: async () => true,
  });
  assert.strictEqual(ok, true);
});

test('waitForPort polls until probe becomes true', async () => {
  let n = 0;
  const probe = async () => ++n >= 3;
  const ok = await proc.waitForPort('127.0.0.1', 3080, {
    timeoutMs: 100,
    intervalMs: 5,
    probe,
  });
  assert.strictEqual(ok, true);
  assert.strictEqual(n, 3);
});

test('waitForPort resolves false on timeout', async () => {
  const ok = await proc.waitForPort('127.0.0.1', 3080, {
    timeoutMs: 30,
    intervalMs: 5,
    probe: async () => false,
  });
  assert.strictEqual(ok, false);
});

test('httpProbe true on dsh-like response', async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<!doctype html><html><head><script>window.__DSH_BOOT__ = {"rev":"x"}</script></head></html>');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  try {
    assert.strictEqual(await proc.httpProbe('127.0.0.1', port), true);
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('httpProbe false on non-dsh response', async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<html>hello world</html>');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  try {
    assert.strictEqual(await proc.httpProbe('127.0.0.1', port), false);
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('httpProbe false when connection refused', async () => {
  const tmp = net.createServer();
  await new Promise((r) => tmp.listen(0, '127.0.0.1', r));
  const port = tmp.address().port;
  await new Promise((r) => tmp.close(r));
  assert.strictEqual(await proc.httpProbe('127.0.0.1', port), false);
});

test('killDsh win runs taskkill /T /F', async () => {
  let captured = null;
  const fakeExecFile = (cmd, args, cb) => {
    captured = { cmd, args };
    cb(null);
  };
  const ok = await proc.killDsh({ pid: 4242, killed: false }, { platform: 'win32', execFile: fakeExecFile });
  assert.strictEqual(ok, true);
  assert.strictEqual(captured.cmd, 'taskkill');
  assert.deepStrictEqual(captured.args, ['/pid', '4242', '/T', '/F']);
});

test('killDsh non-win sends SIGTERM', async () => {
  const child = new EventEmitter();
  child.killed = false;
  let sig = null;
  child.kill = (s) => {
    sig = s;
    child.emit('exit', null, s);
  };
  const ok = await proc.killDsh(child, { platform: 'linux' });
  assert.strictEqual(ok, true);
  assert.strictEqual(sig, 'SIGTERM');
});

test('killDsh returns false when no child', async () => {
  assert.strictEqual(await proc.killDsh(null, { platform: 'linux' }), false);
});

test('buildTerminalCommand joins command and args in order', () => {
  const cmd = proc.buildTerminalCommand(
    { command: 'C:/node/node.exe', prefixArgs: ['C:/bin.js'] },
    { host: '127.0.0.1', port: 3080, patches: [], cwd: 'C:/ws' }
  );
  assert.strictEqual(cmd, 'C:/node/node.exe C:/bin.js web --host 127.0.0.1 --port 3080 --no-open');
});

test('buildTerminalCommand quotes args containing spaces', () => {
  const cmd = proc.buildTerminalCommand(
    { command: 'C:/node/node.exe', prefixArgs: ['C:/my bin.js'] },
    { host: '127.0.0.1', port: 3080, patches: ['C:/ws/.dsh/a b.patch.yml'], cwd: 'C:/ws' }
  );
  assert.strictEqual(
    cmd,
    'C:/node/node.exe "C:/my bin.js" web --patch "C:/ws/.dsh/a b.patch.yml" --host 127.0.0.1 --port 3080 --no-open'
  );
});

test('killPid win runs taskkill /T /F', async () => {
  let captured = null;
  const fakeExecFile = (cmd, args, cb) => {
    captured = { cmd, args };
    cb(null);
  };
  const ok = await proc.killPid(4242, { platform: 'win32', execFile: fakeExecFile });
  assert.strictEqual(ok, true);
  assert.strictEqual(captured.cmd, 'taskkill');
  assert.deepStrictEqual(captured.args, ['/pid', '4242', '/T', '/F']);
});

test('killPid rejects invalid pid', async () => {
  assert.strictEqual(await proc.killPid(null, { platform: 'win32' }), false);
  assert.strictEqual(await proc.killPid(0, { platform: 'win32' }), false);
  assert.strictEqual(await proc.killPid(-1, { platform: 'win32' }), false);
});

test('killPid non-win kills via process.kill', async () => {
  const cp = require('node:child_process');
  const child = cp.spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore' });
  const ok = await proc.killPid(child.pid, { platform: 'linux' });
  assert.strictEqual(ok, true);
  await new Promise((r) => child.once('exit', r));
});