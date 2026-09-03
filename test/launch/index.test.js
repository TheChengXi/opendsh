/**
 * @intent
 * 五模式分发器单测：断言 createLauncher(deps) 按 launchMode 路由到对应启动器，未知 mode 抛错。
 * 依赖全注入（vscode/process/patch），验证分发契约而非单一模式细节（细节在各启动器单测覆盖）。
 *
 * 验收条件：node --test test/launch/ 全绿——integrated 返回 {kind:'terminal'}、其余四模式返回 {kind:'child'}、
 * 未知 mode 抛 Error。
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { createLauncher } = require('../../src/launch/index');

function makeDeps() {
  const calls = { spawned: null, terminals: [], standalone: null };
  const deps = {
    vscode: {
      window: {
        createTerminal: (name) => {
          const t = { name, sent: [], shown: 0 };
          t.sendText = (txt) => {
            t.sent.push(txt);
          };
          t.show = () => {
            t.shown++;
          };
          calls.terminals.push(t);
          return t;
        },
      },
    },
    process: {
      buildTerminalCommand: () => 'dsh web',
      spawnDshVisible: () => {
        calls.spawned = 'visible';
        return { pid: 8 };
      },
      spawnDsh: () => {
        calls.spawned = 'hidden';
        return { pid: 1 };
      },
      spawnStandalone: async (r, o) => {
        calls.standalone = o;
        return { pid: 9 };
      },
    },
    patch: {
      isApplied: () => true,
      buildPatchCommand: () => "node -e 'x'",
    },
  };
  return { deps, calls };
}

function ctx() {
  return {
    resolved: { command: 'dsh', prefixArgs: [] },
    config: { host: '127.0.0.1', port: 3080, windowsHidePatch: false },
    workspace: '/ws',
    patches: [],
  };
}

test('launcher routes integrated to terminal descriptor', async () => {
  const { deps, calls } = makeDeps();
  const launcher = createLauncher(deps);
  const out = await launcher.start('integrated', ctx());
  assert.strictEqual(out.kind, 'terminal');
  assert.strictEqual(out.terminal, calls.terminals[0]);
  assert.strictEqual(calls.spawned, null);
});

test('launcher routes window/hidden/keepalive modes to child records', async () => {
  const { deps, calls } = makeDeps();
  const launcher = createLauncher(deps);

  const w = await launcher.start('window', ctx());
  assert.strictEqual(w.kind, 'child');
  assert.strictEqual(w.child.pid, 8);

  const h = await launcher.start('hidden', ctx());
  assert.strictEqual(h.kind, 'child');
  assert.strictEqual(h.child.pid, 1);

  const wk = await launcher.start('window-keepalive', ctx());
  assert.strictEqual(wk.kind, 'child');
  assert.deepStrictEqual(wk.child, { pid: 9 });
  assert.strictEqual(calls.standalone.showWindow, true);

  const hk = await launcher.start('hidden-keepalive', ctx());
  assert.strictEqual(hk.kind, 'child');
  assert.deepStrictEqual(hk.child, { pid: 9 });
  assert.strictEqual(calls.standalone.showWindow, false);
});

test('launcher throws on unknown launch mode', async () => {
  const { deps } = makeDeps();
  const launcher = createLauncher(deps);
  assert.throws(() => launcher.start('bogus', ctx()), /unknown launch mode: bogus/);
});