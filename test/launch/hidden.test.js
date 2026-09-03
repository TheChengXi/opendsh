/**
 * @intent
 * hidden 启动器单测：注入假 process，断言只做 spawnDsh 静默启动并返回统一 child 描述。
 *
 * 验收条件：node --test test/launch/ 全绿——start 返回 {kind:'child'}、child 为 spawnDsh 产物、
 * opts 含 host/port/patches/cwd、不写 pid、不注册引用清理（生命周期归 manager）。
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { createHiddenLauncher } = require('../../src/launch/hidden');

function ctx(over) {
  return Object.assign(
    {
      resolved: { command: 'dsh', prefixArgs: [] },
      config: { host: '127.0.0.1', port: 3080 },
      workspace: '/ws',
      patches: ['/ws/.dsh/a.patch.yml'],
    },
    over || {}
  );
}

test('hidden start spawns silent child and returns child descriptor', async () => {
  let seen = null;
  const deps = {
    process: {
      spawnDsh: (r, o) => {
        seen = { r, o };
        return { pid: 1, killed: false };
      },
    },
  };
  const launcher = createHiddenLauncher(deps);
  const c = ctx();

  const out = await launcher.start(c);

  assert.strictEqual(out.kind, 'child');
  assert.strictEqual(out.child.pid, 1);
  assert.strictEqual(seen.r, c.resolved);
  assert.strictEqual(seen.o.host, c.config.host);
  assert.strictEqual(seen.o.port, c.config.port);
  assert.strictEqual(seen.o.cwd, c.workspace);
  assert.deepStrictEqual(seen.o.patches, c.patches);
});