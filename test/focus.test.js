/**
 * @intent
 * focus.js 的 node:test 单测，注入假 detect/vscode/webview 断言聚焦多承载面（三个 WebviewPanel）的创建、复用与清理：
 * VIEW_SPECS 表驱动创建、html 含对应聚焦 URL、panel 复用（reveal）、关闭后重建、reset 清状态。
 *
 * 验收条件：node --test 全绿；不依赖真实 DSH 服务（mock 系统边界 vscode，webview 用真实模块）。
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const {
  createFocus,
  VIEW_SPECS,
  FOCUS_SESSIONS_VIEW_ID,
  FOCUS_CONVERSATION_VIEW_ID,
  FOCUS_INPUT_VIEW_ID,
} = require('../src/focus');
const webview = require('../src/webview');

function makeHarness(opts) {
  opts = opts || {};
  const calls = {
    panels: [],
    commands: [],
  };

  const fakeDetect = {
    buildFocusUrls: (h, p) => ({
      sessions: `http://${h}:${p}/?focus=sidebar`,
      conversation: `http://${h}:${p}/?focus=conversation.session`,
      composer: `http://${h}:${p}/?focus=conversation.composer`,
    }),
    ...(opts.detect || {}),
  };

  const vscode = {
    workspace: {
      getConfiguration: () => ({
        get: (k) => (k === 'host' ? '127.0.0.1' : k === 'port' ? 3080 : undefined),
      }),
    },
    ViewColumn: { One: 1, Two: 2, Beside: 3 },
    commands: {
      executeCommand: (cmd, arg) => {
        calls.commands.push({ cmd, arg });
        return Promise.resolve();
      },
    },
    window: {
      createWebviewPanel: (viewType, title, column, options) => {
        const p = {
          viewType,
          title,
          column,
          options,
          revealed: 0,
          _html: '',
          _dispose: null,
          webview: {
            get html() {
              return p._html;
            },
            set html(v) {
              p._html = v;
            },
          },
          reveal: (col, focus) => {
            p.revealed++;
            p.revealArgs = { col, focus };
          },
          onDidDispose: (cb) => {
            p._dispose = cb;
          },
        };
        calls.panels.push(p);
        return p;
      },
    },
  };

  const focus = createFocus({ detect: fakeDetect, webview, vscode });
  return { focus, calls };
}

const config = { host: '127.0.0.1', webviewHost: '127.0.0.1', port: 3080 };

test('open creates one panel per VIEW_SPECS with focus URLs', () => {
  const h = makeHarness();
  h.focus.open(config);
  assert.strictEqual(h.calls.panels.length, VIEW_SPECS.length);
  const byType = new Map(h.calls.panels.map((p) => [p.viewType, p]));
  assert.ok(byType.get(FOCUS_SESSIONS_VIEW_ID)._html.includes('?focus=sidebar'));
  assert.ok(byType.get(FOCUS_CONVERSATION_VIEW_ID)._html.includes('?focus=conversation.session'));
  assert.ok(byType.get(FOCUS_INPUT_VIEW_ID)._html.includes('?focus=conversation.composer'));
});

test('second open reuses panels (reveal, no duplicate create)', () => {
  const h = makeHarness();
  h.focus.open(config);
  h.focus.open(config);
  assert.strictEqual(h.calls.panels.length, VIEW_SPECS.length); // 不重复创建
  assert.ok(h.calls.panels.every((p) => p.revealed >= 2));
});

test('panel dispose clears reference; reopen rebuilds', () => {
  const h = makeHarness();
  h.focus.open(config);
  assert.strictEqual(h.focus.getState().panels, VIEW_SPECS.length);
  h.calls.panels[0]._dispose(); // 关闭第一个 panel
  assert.strictEqual(h.focus.getState().panels, VIEW_SPECS.length - 1);
  h.focus.open(config); // 重建
  assert.strictEqual(h.calls.panels.length, VIEW_SPECS.length + 1);
  assert.strictEqual(h.focus.getState().panels, VIEW_SPECS.length);
});

test('open uses webviewHost for focus urls (service management host stays separate)', () => {
  const h = makeHarness();
  h.focus.open({ host: '127.0.0.1', webviewHost: 'dsh.local', port: 3081 });
  assert.deepStrictEqual(h.focus.getState().urls, {
    sessions: 'http://dsh.local:3081/?focus=sidebar',
    conversation: 'http://dsh.local:3081/?focus=conversation.session',
    composer: 'http://dsh.local:3081/?focus=conversation.composer',
  });
});

test('reset clears state without touching VSCode', () => {
  const h = makeHarness();
  h.focus.open(config);
  assert.strictEqual(h.focus.getState().panels, VIEW_SPECS.length);
  h.focus.reset();
  const state = h.focus.getState();
  assert.strictEqual(state.panels, 0);
  assert.strictEqual(state.urls, null);
});

test('open applies vertical split layout, input in lower group', () => {
  const h = makeHarness();
  h.focus.open(config);
  // setEditorLayout 被调用：上下分栏 70/30
  const layoutCmd = h.calls.commands.find((c) => c.cmd === 'vscode.setEditorLayout');
  assert.ok(layoutCmd);
  assert.strictEqual(layoutCmd.arg.orientation, 1);
  assert.deepStrictEqual(layoutCmd.arg.groups.map((g) => g.size), [0.7, 0.3]);
  // 输入区在下组（Two），会话列表 + 消息流在上组（One）
  const byType = new Map(h.calls.panels.map((p) => [p.viewType, p]));
  assert.strictEqual(byType.get(FOCUS_INPUT_VIEW_ID).column, 2);
  assert.strictEqual(byType.get(FOCUS_SESSIONS_VIEW_ID).column, 1);
  assert.strictEqual(byType.get(FOCUS_CONVERSATION_VIEW_ID).column, 1);
});
