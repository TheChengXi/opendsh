/**
 * @intent
 * manager.js 的 node:test 编排测试，注入假 detect/process/vscode 断言决策顺序与边界。
 *
 * 验收条件：node --test 全绿，覆盖 open 自动启动、启动去重复用 child、端口占用归属判定、无工作区报错、
 * resolveDsh null 快速失败、端口超时报错、open 回退、channel 日志、stop 无 child 提示。
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createManager } = require('../src/manager');

function makeHarness(opts) {
  opts = opts || {};
  const calls = {
    messages: [],
    opened: [],
    external: [],
    spawned: null,
    spawnCount: 0,
    killed: null,
    killedPid: null,
    waited: null,
    waitedCount: 0,
    channel: null,
  };

  const fakeDetect = {
    resolveConfig: (s) => s,
    resolveWorkspace: (folders) =>
      (folders && folders[0] && folders[0].uri && folders[0].uri.fsPath) || null,
    resolvePatches: () => ['/ws/.dsh/a.patch.yml'],
    resolveDsh: () => ({ command: 'dsh', prefixArgs: [] }),
    buildUrl: (h, p) => `http://${h}:${p}`,
    ...(opts.detect || {}),
  };

  const fakeProc = {
    isPortInUse: async () => false,
    httpProbe: async () => true,
    spawnDsh: (r, o) => {
      calls.spawned = { r, o };
      calls.spawnCount++;
      return { pid: 1, killed: false };
    },
    waitForPort: async (host, port) => {
      calls.waited = { host, port };
      calls.waitedCount++;
      return true;
    },
    killDsh: async () => {
      calls.killed = true;
      return true;
    },
    killPid: async (pid) => {
      calls.killedPid = pid;
      return true;
    },
    spawnStandalone: async (r, o) => {
      calls.spawned = { r, o, standalone: true };
      calls.spawnCount++;
      return { pid: 9 };
    },
    ...(opts.process || {}),
  };

  const baseSettings = { host: '127.0.0.1', port: 3080, dshPath: '', patchFile: '' };
  const cfgGet = (key) =>
    opts.settings && opts.settings[key] !== undefined ? opts.settings[key] : baseSettings[key];

  const vscode = {
    workspace: {
      getConfiguration: () => ({ get: cfgGet }),
      workspaceFolders: opts.folders !== undefined ? opts.folders : [{ uri: { fsPath: '/ws' } }],
    },
    Uri: { parse: (u) => u },
    commands: {
      executeCommand: async (cmd, uri) => {
        if (opts.throwOnOpen) throw new Error('no simple browser');
        calls.opened.push({ cmd, uri });
      },
    },
    env: { openExternal: async (uri) => calls.external.push(uri) },
    window: {
      showErrorMessage: (m) => calls.messages.push({ kind: 'error', m }),
      showInformationMessage: (m) => calls.messages.push({ kind: 'info', m }),
      createOutputChannel: (name) => {
        calls.channel = { name, lines: [], appended: '' };
        return {
          appendLine: (l) => calls.channel.lines.push(l),
          append: (s) => {
            calls.channel.appended += s;
          },
        };
      },
    },
  };

  const manager = createManager({ detect: fakeDetect, process: fakeProc, vscode });
  return { manager, calls };
}

test('open auto-starts when port free', async () => {
  const h = makeHarness();
  await h.manager.open();
  assert.ok(h.calls.spawned);
  assert.strictEqual(h.calls.spawned.o.cwd, '/ws');
  assert.ok(h.calls.waited);
  assert.strictEqual(h.calls.waited.host, '127.0.0.1');
  assert.strictEqual(h.calls.waited.port, 3080);
  assert.strictEqual(h.calls.opened.length, 1);
  assert.ok(h.manager.getChild());
});

test('open skips spawn when port in use', async () => {
  const h = makeHarness({
    process: {
      isPortInUse: async () => true,
      spawnDsh: () => {
        throw new Error('should not spawn');
      },
      killDsh: async () => true,
    },
  });
  await h.manager.open();
  assert.strictEqual(h.calls.spawned, null);
  assert.strictEqual(h.calls.opened.length, 1);
  assert.strictEqual(h.manager.getChild(), null);
});

test('open opens without workspace when port already in use', async () => {
  const h = makeHarness({
    folders: [],
    process: {
      isPortInUse: async () => true,
      spawnDsh: () => {
        throw new Error('should not spawn');
      },
      killDsh: async () => true,
    },
  });
  await h.manager.open();
  assert.strictEqual(h.calls.spawned, null);
  assert.strictEqual(h.calls.opened.length, 1);
});

test('open shows error when port free and no workspace', async () => {
  const h = makeHarness({ folders: [] });
  await h.manager.open();
  assert.strictEqual(h.calls.spawned, null);
  assert.strictEqual(h.calls.opened.length, 0);
  assert.ok(h.calls.messages.some((x) => x.kind === 'error'));
});

test('open shows error when server fails to start (port timeout)', async () => {
  const h = makeHarness({
    process: {
      isPortInUse: async () => false,
      waitForPort: async () => false,
      killDsh: async () => true,
    },
  });
  await h.manager.open();
  assert.ok(h.calls.spawned);
  assert.strictEqual(h.calls.opened.length, 0);
  assert.ok(h.calls.messages.some((x) => x.kind === 'error'));
});

test('open falls back to external browser when simpleBrowser throws', async () => {
  const h = makeHarness({ throwOnOpen: true });
  await h.manager.open();
  assert.strictEqual(h.calls.external.length, 1);
  assert.strictEqual(h.calls.opened.length, 0);
});

test('stop with no child shows info and does not kill', async () => {
  const h = makeHarness();
  await h.manager.stop();
  assert.strictEqual(h.calls.killed, null);
  assert.ok(h.calls.messages.some((x) => x.kind === 'info'));
});

test('stop kills tracked child then clears it', async () => {
  const h = makeHarness();
  await h.manager.open();
  await h.manager.stop();
  assert.strictEqual(h.calls.killed, true);
  assert.strictEqual(h.manager.getChild(), null);
});

test('open reuses existing child instead of duplicate spawn', async () => {
  const h = makeHarness();
  await h.manager.open(); // first spawn
  assert.strictEqual(h.calls.spawnCount, 1);
  await h.manager.open(); // second must reuse, not spawn
  assert.strictEqual(h.calls.spawnCount, 1);
  assert.ok(h.calls.waitedCount >= 2);
  assert.strictEqual(h.calls.opened.length, 2);
});

test('open reports port occupied by non-dsh program', async () => {
  const h = makeHarness({
    process: {
      isPortInUse: async () => true,
      httpProbe: async () => false,
      killDsh: async () => true,
    },
  });
  await h.manager.open();
  assert.strictEqual(h.calls.spawnCount, 0);
  assert.strictEqual(h.calls.opened.length, 0);
  assert.ok(h.calls.messages.some((x) => x.kind === 'error' && x.m.includes('in use')));
});

test('open opens when listening port is external dsh', async () => {
  const h = makeHarness({
    process: {
      isPortInUse: async () => true,
      httpProbe: async () => true,
      killDsh: async () => true,
    },
  });
  await h.manager.open();
  assert.strictEqual(h.calls.spawnCount, 0);
  assert.strictEqual(h.calls.opened.length, 1);
});

test('open fails fast when resolveDsh returns null', async () => {
  const h = makeHarness({
    detect: { resolveDsh: async () => null },
  });
  await h.manager.open();
  assert.strictEqual(h.calls.spawnCount, 0);
  assert.strictEqual(h.calls.opened.length, 0);
  assert.ok(h.calls.messages.some((x) => x.kind === 'error' && x.m.includes('dsh not found')));
});

test('open writes startup logs to output channel', async () => {
  const h = makeHarness();
  await h.manager.open();
  assert.ok(h.calls.channel);
  assert.ok(h.calls.channel.lines.length >= 2);
  assert.ok(h.calls.channel.lines.some((l) => l.includes('spawning')));
  assert.ok(h.calls.channel.lines.some((l) => l.includes('ready')));
});

test('dispose kills tracked child silently and clears it', async () => {
  const h = makeHarness();
  await h.manager.open();
  assert.strictEqual(h.calls.spawnCount, 1);
  await h.manager.dispose();
  assert.strictEqual(h.calls.killed, true);
  assert.strictEqual(h.manager.getChild(), null);
  // dispose 不弹任何消息
  assert.strictEqual(h.calls.messages.length, 0);
});

test('dispose is safe without child', async () => {
  const h = makeHarness();
  await h.manager.dispose();
  assert.strictEqual(h.calls.killed, null);
});

test('dispose does not kill child in detached (standalone) mode', async () => {
  const h = makeHarness({ settings: { detached: true } });
  await h.manager.open();
  assert.strictEqual(h.calls.spawnCount, 1);
  await h.manager.dispose();
  // 独立存活模式：dispose 不杀、不清引用
  assert.strictEqual(h.calls.killed, null);
  assert.ok(h.manager.getChild());
});

test('open writes pid file after successful spawn', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opendsh-pid-'));
  try {
    const h = makeHarness({ folders: [{ uri: { fsPath: dir } }] });
    await h.manager.open();
    const pidFile = path.join(dir, '.dsh', 'opendsh.pid');
    assert.ok(fs.existsSync(pidFile));
    assert.strictEqual(Number(fs.readFileSync(pidFile, 'utf8').trim()), 1); // fake child pid=1
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('stop kills residual server via pid file when child is gone', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opendsh-residual-'));
  try {
    fs.mkdirSync(path.join(dir, '.dsh'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.dsh', 'opendsh.pid'), '4242');
    const h = makeHarness({
      folders: [{ uri: { fsPath: dir } }],
      process: { isPortInUse: async () => true, httpProbe: async () => true, killDsh: async () => true },
    });
    await h.manager.stop();
    assert.strictEqual(h.calls.killedPid, 4242);
    assert.ok(h.calls.messages.some((x) => x.kind === 'info' && x.m.includes('stopped')));
    assert.ok(!fs.existsSync(path.join(dir, '.dsh', 'opendsh.pid')));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('stop removes stale pid file when port not listening', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opendsh-stale-'));
  try {
    fs.mkdirSync(path.join(dir, '.dsh'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.dsh', 'opendsh.pid'), '4242');
    const h = makeHarness({ folders: [{ uri: { fsPath: dir } }] }); // 默认 isPortInUse false
    await h.manager.stop();
    assert.strictEqual(h.calls.killedPid, null);
    assert.ok(h.calls.messages.some((x) => x.kind === 'info' && x.m.includes('not running')));
    assert.ok(!fs.existsSync(path.join(dir, '.dsh', 'opendsh.pid')));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('stop does not kill pid when port is foreign program', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opendsh-foreign-'));
  try {
    fs.mkdirSync(path.join(dir, '.dsh'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.dsh', 'opendsh.pid'), '4242');
    const h = makeHarness({
      folders: [{ uri: { fsPath: dir } }],
      process: { isPortInUse: async () => true, httpProbe: async () => false, killDsh: async () => true },
    });
    await h.manager.stop();
    assert.strictEqual(h.calls.killedPid, null);
    assert.ok(h.calls.messages.some((x) => x.kind === 'error' && x.m.includes('in use')));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('dispose removes pid file when killing', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opendsh-dispose-'));
  try {
    const h = makeHarness({ folders: [{ uri: { fsPath: dir } }] });
    await h.manager.open();
    assert.ok(fs.existsSync(path.join(dir, '.dsh', 'opendsh.pid')));
    await h.manager.dispose();
    assert.ok(!fs.existsSync(path.join(dir, '.dsh', 'opendsh.pid')));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('open detached uses spawnStandalone and stop kills pseudo child', async () => {
  const h = makeHarness({ settings: { detached: true } });
  await h.manager.open();
  assert.strictEqual(h.calls.spawnCount, 1);
  assert.ok(h.calls.spawned.standalone);
  // child 为伪对象 { pid: 9 }
  assert.strictEqual(h.manager.getChild().pid, 9);
  // stop 经 killDsh 杀（内部按 pid）
  await h.manager.stop();
  assert.strictEqual(h.calls.killed, true);
  assert.strictEqual(h.manager.getChild(), null);
});