/**
 * @intent
 * process.js 的 node:test 单测，覆盖参数拼接、端口探测（真实 socket）、spawn 平台分支、kill 树杀参数。
 *
 * 验收条件：node --test 全绿，只 mock spawn / taskkill 系统边界，不 mock 内部协作者。
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const net = require('node:net');
const { EventEmitter } = require('node:events');
const proc = require('../src/process');

test('buildDshArgs builds ordered args with prefix and patches', () => {
  const args = proc.buildDshArgs(
    { command: 'dsh', prefixArgs: [] },
    { host: '127.0.0.1', port: 3080, patches: ['a.yml', 'b.yml'] }
  );
  assert.deepStrictEqual(args, [
    'web',
    '--host',
    '127.0.0.1',
    '--port',
    '3080',
    '--patch',
    'a.yml',
    '--patch',
    'b.yml',
  ]);
});

test('buildDshArgs prepends npx prefix', () => {
  const args = proc.buildDshArgs(
    { command: 'npx', prefixArgs: ['@deepseek-ai/dsh'] },
    { host: '127.0.0.1', port: 3080, patches: [] }
  );
  assert.deepStrictEqual(args, ['@deepseek-ai/dsh', 'web', '--host', '127.0.0.1', '--port', '3080']);
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
  assert.deepStrictEqual(captured.args, ['web', '--host', '127.0.0.1', '--port', '3080']);
  assert.strictEqual(captured.opts.shell, false);
  assert.strictEqual(captured.opts.detached, true);
  assert.strictEqual(captured.opts.stdio, 'ignore');
  assert.strictEqual(captured.opts.cwd, '/ws');
});

test('spawnDsh win spawns with shell true and windowsHide', () => {
  let captured = null;
  const fakeSpawn = (cmd, args, opts) => {
    captured = { cmd, args, opts };
    return { pid: 2, unref() {} };
  };
  proc.spawnDsh(
    { command: 'dsh', prefixArgs: [] },
    { platform: 'win32', host: '127.0.0.1', port: 8080, patches: ['C:/ws/.dsh/a.patch.yml'], cwd: 'C:/ws' },
    fakeSpawn
  );
  assert.strictEqual(captured.cmd, 'dsh');
  assert.deepStrictEqual(captured.args, [
    'web',
    '--host',
    '127.0.0.1',
    '--port',
    '8080',
    '--patch',
    'C:/ws/.dsh/a.patch.yml',
  ]);
  assert.strictEqual(captured.opts.shell, true);
  assert.strictEqual(captured.opts.windowsHide, true);
  assert.strictEqual(captured.opts.detached, true);
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
