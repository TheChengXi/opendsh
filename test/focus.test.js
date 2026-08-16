/**
 * @intent
 * focus.js 的 node:test 单测，注入假 detect/vscode/webview 断言聚焦双承载面的注册、复用与清理：
 * 侧栏对话 provider 与主编辑区输入 panel 的创建/复用/重建、reset 清引用。
 *
 * 验收条件：node --test 全绿；不依赖真实 DSH 服务（mock system 边界 vscode）。
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { createFocus, FOCUS_CHAT_VIEW_ID, FOCUS_INPUT_PANEL_ID } = require('../src/focus');
const webview = require('../src/webview');

function makeHarness(opts) {
  opts = opts || {};
  const calls = {
    providers: [],
    panels: [],
    commands: [],
    resolvedHtml: [],
  };

  const fakeDetect = {
    buildFocusUrls: (h, p) => ({
      conversation: `http://${h}:${p}/?focus=conversation`,
      composer: `http://${h}:${p}/?focus=composer`,
    }),
    ...(opts.detect || {}),
  };

  const vscode = {
    ViewColumn: { Active: 1 },
    commands: {
      executeCommand: (cmd) => {
        calls.commands.push(cmd);
        return Promise.resolve();
      },
    },
    window: {
      registerWebviewViewProvider: (viewType, provider, opts) => {
        calls.providers.push({ viewType, provider, opts });
      },
      createWebviewPanel: (viewType, title, column, options) => {
        if (opts.throwOnPanel) throw new Error('panel unavailable');
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

// 手动调用侧栏 provider 的 resolveWebviewView，模拟 VS Code 扩容视图
function resolveSide(calls, index) {
  const provider = calls.providers[index].provider;
  let view;
  const wv = {
    get html() {
      return view._html;
    },
    set html(v) {
      view._html = v;
    },
  };
  view = { webview: wv, _html: '' };
  provider.resolveWebviewView(view);
  calls.resolvedHtml.push(view._html);
  return view;
}

const config = { host: '127.0.0.1', port: 3080 };

test('open registers side provider and creates main input panel with focus URLs', () => {
  const h = makeHarness();
  h.focus.open(config);
  assert.strictEqual(h.calls.providers.length, 1);
  assert.strictEqual(h.calls.providers[0].viewType, FOCUS_CHAT_VIEW_ID);
  assert.ok(h.calls.providers[0].opts.webviewOptions.enableScripts);
  assert.strictEqual(h.calls.panels.length, 1);
  assert.strictEqual(h.calls.panels[0].viewType, FOCUS_INPUT_PANEL_ID);
  // 主区 panel 是输入区 URL（composer）
  assert.ok(h.calls.panels[0]._html.includes('?focus=composer'));
  // 侧栏 provider resolve 后为对话视图 URL（conversation）
  resolveSide(h.calls, 0);
  assert.strictEqual(h.calls.resolvedHtml.length, 1);
  assert.ok(h.calls.resolvedHtml[0].includes('?focus=conversation'));
});

test('open reuses provider and reveals existing panel on second open', () => {
  const h = makeHarness();
  h.focus.open(config);
  h.focus.open(config);
  assert.strictEqual(h.calls.providers.length, 1); // 不重复注册
  assert.strictEqual(h.calls.panels.length, 1); // 复用 panel
  assert.strictEqual(h.calls.panels[0].revealed, 1);
});

test('open rebuilds main panel after dispose clears it', () => {
  const h = makeHarness();
  h.focus.open(config);
  h.calls.panels[0]._dispose(); // 关主区标签页
  h.focus.open(config);
  assert.strictEqual(h.calls.panels.length, 2); // 重建
});

test('reset clears state without touching VSCode', () => {
  const h = makeHarness();
  h.focus.open(config);
  assert.ok(h.focus.getState().panel);
  h.focus.reset();
  const state = h.focus.getState();
  assert.strictEqual(state.panel, false);
  assert.strictEqual(state.sideView, false);
});
