/**
 * @intent
 * manager.js 的 node:test 编排测试，注入假 detect/process/vscode 断言决策顺序与边界。
 *
 * 验收条件：node --test 全绿，覆盖 start 顺序、端口占用跳过 spawn、无工作区报错、stop 无 child 提示。
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { createManager } = require('../src/manager');

function makeHarness(opts) {
  opts = opts || {};
  const calls = { messages: [], opened: [], external: [], spawned: null, killed: null };

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
    spawnDsh: (r, o) => {
      calls.spawned = { r, o };
      return { pid: 1, killed: false };
    },
    killDsh: async () => {
      calls.killed = true;
      return true;
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
    },
  };

  const manager = createManager({ detect: fakeDetect, process: fakeProc, vscode });
  return { manager, calls };
}

test('start spawns then opens when port free', async () => {
  const h = makeHarness();
  await h.manager.start();
  assert.ok(h.calls.spawned);
  assert.strictEqual(h.calls.spawned.o.cwd, '/ws');
  assert.strictEqual(h.calls.opened.length, 1);
  assert.ok(h.manager.getChild());
});

test('start skips spawn when port in use', async () => {
  const h = makeHarness({
    process: {
      isPortInUse: async () => true,
      spawnDsh: () => {
        throw new Error('should not spawn');
      },
      killDsh: async () => true,
    },
  });
  await h.manager.start();
  assert.strictEqual(h.calls.spawned, null);
  assert.strictEqual(h.calls.opened.length, 1);
  assert.strictEqual(h.manager.getChild(), null);
});

test('start shows error when no workspace', async () => {
  const h = makeHarness({ folders: [] });
  await h.manager.start();
  assert.strictEqual(h.calls.spawned, null);
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
  await h.manager.start();
  await h.manager.stop();
  assert.strictEqual(h.calls.killed, true);
  assert.strictEqual(h.manager.getChild(), null);
});
