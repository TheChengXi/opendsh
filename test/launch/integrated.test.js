/**
 * @intent
 * integrated 启动器单测：注入假 vscode/process，断言只做「组装命令 + createTerminal + show + sendText」并返回统一 terminal 描述。
 *
 * 验收条件：node --test test/launch/ 全绿——start 返回 {kind:'terminal'}、终端已 sendText/show、
 * buildTerminalCommand 收到 host/port/patches/cwd、不写 pid、不注册 onDidClose（引用生命周期归 manager）。
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { createIntegratedLauncher } = require('../../src/launch/integrated');

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

function makeDeps(over) {
  const calls = { cmds: [], terminals: [] };
  const deps = {
    process: {
      buildTerminalCommand: (r, o) => {
        calls.cmds.push({ r, o });
        return 'dsh web --host 127.0.0.1 --port 3080';
      },
    },
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
    ...over,
  };
  return { deps, calls };
}

test('integrated start assembles command and returns terminal descriptor', async () => {
  const { deps, calls } = makeDeps();
  const launcher = createIntegratedLauncher(deps);
  const c = ctx();

  const out = await launcher.start(c);

  assert.strictEqual(out.kind, 'terminal');
  assert.strictEqual(out.terminal, calls.terminals[0]);
  assert.strictEqual(calls.terminals.length, 1);
  assert.strictEqual(calls.terminals[0].name, 'DSH');
  assert.strictEqual(calls.terminals[0].sent.length, 1);
  assert.strictEqual(calls.terminals[0].shown, 1);
  assert.strictEqual(calls.cmds.length, 1);
  assert.strictEqual(calls.cmds[0].o.host, c.config.host);
  assert.strictEqual(calls.cmds[0].o.port, c.config.port);
  assert.strictEqual(calls.cmds[0].o.cwd, c.workspace);
  assert.deepStrictEqual(calls.cmds[0].o.patches, c.patches);
});