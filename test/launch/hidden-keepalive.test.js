/**
 * @intent
 * hidden-keepalive 启动器单测：注入假 vscode/process/patch，断言可选补丁 + spawnStandalone(showWindow=false) 产出伪 child。
 *
 * 验收条件：node --test test/launch/ 全绿——windowsHidePatch 未启用不查 isApplied/不发补丁；
 * 启用且未打则 isApplied 检测 + createTerminal('DSH patch') 发 buildPatchCommand；已打则跳过；
 * start 始终返回 {kind:'child', child:{pid}}，spawnStandalone 收到 showWindow:false。
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { createHiddenKeepaliveLauncher } = require('../../src/launch/hidden-keepalive');

function ctx(over) {
  return Object.assign(
    {
      resolved: { command: 'dsh', prefixArgs: [] },
      config: { host: '127.0.0.1', port: 3080, windowsHidePatch: true },
      workspace: '/ws',
      patches: ['/ws/.dsh/a.patch.yml'],
    },
    over || {}
  );
}

function makeDeps(over) {
  const calls = { isAppliedChecks: 0, terminals: [], spawned: null, patchCommandsBuilt: 0 };
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
      spawnStandalone: async (r, o) => {
        calls.spawned = { r, o };
        return { pid: 9 };
      },
    },
    patch: {
      isApplied: () => {
        calls.isAppliedChecks++;
        return over.patchApplied !== undefined ? over.patchApplied : true;
      },
      buildPatchCommand: () => {
        calls.patchCommandsBuilt++;
        return "node -e 'x'";
      },
    },
  };
  return { deps, calls };
}

test('hidden-keepalive with patch enabled and not applied patches then starts standalone silent', async () => {
  const { deps, calls } = makeDeps({ patchApplied: false });
  const launcher = createHiddenKeepaliveLauncher(deps);
  const c = ctx();

  const out = await launcher.start(c);

  assert.strictEqual(out.kind, 'child');
  assert.deepStrictEqual(out.child, { pid: 9 });
  assert.strictEqual(calls.isAppliedChecks, 1);
  assert.strictEqual(calls.patchCommandsBuilt, 1);
  assert.strictEqual(calls.terminals.length, 1);
  assert.strictEqual(calls.terminals[0].name, 'DSH patch');
  assert.strictEqual(calls.terminals[0].sent.length, 1);
  assert.strictEqual(calls.terminals[0].shown, 1);
  assert.strictEqual(calls.spawned.o.showWindow, false);
  assert.strictEqual(calls.spawned.o.host, c.config.host);
  assert.strictEqual(calls.spawned.o.port, c.config.port);
  assert.strictEqual(calls.spawned.o.cwd, c.workspace);
  assert.deepStrictEqual(calls.spawned.o.patches, c.patches);
});

test('hidden-keepalive skips patch when already applied', async () => {
  const { deps, calls } = makeDeps({ patchApplied: true });
  const launcher = createHiddenKeepaliveLauncher(deps);
  const c = ctx();

  const out = await launcher.start(c);

  assert.strictEqual(out.kind, 'child');
  assert.strictEqual(calls.isAppliedChecks, 1);
  assert.strictEqual(calls.patchCommandsBuilt, 0);
  assert.strictEqual(calls.terminals.length, 0);
  assert.strictEqual(calls.spawned.o.showWindow, false);
});

test('hidden-keepalive without patch flag does not check or patch', async () => {
  const { deps, calls } = makeDeps({ patchApplied: false });
  const launcher = createHiddenKeepaliveLauncher(deps);
  const c = ctx({ config: { host: '127.0.0.1', port: 3080, windowsHidePatch: false } });

  const out = await launcher.start(c);

  assert.strictEqual(out.kind, 'child');
  assert.strictEqual(calls.isAppliedChecks, 0);
  assert.strictEqual(calls.terminals.length, 0);
  assert.strictEqual(calls.spawned.o.showWindow, false);
});