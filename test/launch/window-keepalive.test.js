/**
 * @intent
 * window-keepalive 启动器单测：注入假 process，断言 spawnStandalone(showWindow=true) 产出含 pid 伪 child。
 *
 * 验收条件：node --test test/launch/ 全绿——start 返回 {kind:'child', child:{pid}}、
 * spawnStandalone 收到 showWindow:true、opts 含 host/port/patches/cwd、不写 pid（生命周期归 manager）。
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { createWindowKeepaliveLauncher } = require('../../src/launch/window-keepalive');

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

test('window-keepalive start spawns standalone with showWindow=true', async () => {
  let seen = null;
  const deps = {
    process: {
      spawnStandalone: async (r, o) => {
        seen = { r, o };
        return { pid: 9 };
      },
    },
  };
  const launcher = createWindowKeepaliveLauncher(deps);
  const c = ctx();

  const out = await launcher.start(c);

  assert.strictEqual(out.kind, 'child');
  assert.deepStrictEqual(out.child, { pid: 9 });
  assert.strictEqual(seen.r, c.resolved);
  assert.strictEqual(seen.o.showWindow, true);
  assert.strictEqual(seen.o.host, c.config.host);
  assert.strictEqual(seen.o.port, c.config.port);
  assert.strictEqual(seen.o.cwd, c.workspace);
  assert.deepStrictEqual(seen.o.patches, c.patches);
});