/**
 * @intent
 * 聚焦打开模式的承载面编排：openWith=focus 时由 manager 委托本模块，同时维护两个独立承载面——
 * ① VS Code 侧栏对话视图（webview view，iframe 指向 ?focus=conversation 消息流，不含输入区与 DSH 大侧栏）；
 * ② 主编辑区输入 webview（createWebviewPanel，iframe 指向 ?focus=composer 输入区，不含消息流）。
 * 两个 URL 由 detect.buildFocusUrls 按统一契约组装；本模块只负责承载面的注册/复用/清理，不管理 dsh 服务进程
 * （服务生命周期仍归 manager）。侧栏 provider 仅在首次 open 时注册一次，后续复用；主编辑区 panel 存活则 reveal。
 *
 * 边界：config 由调用方（manager 经 detect.resolveConfig）注入，本模块不校验 host/port/openWith；
 * detect 缺 buildFocusUrls 时立即抛错（契约缺失是装配错误，不允许静默）；
 * 创建主区 panel 抛错时不回退（由 manager 捕获后 openExternal）；侧栏 provider 注册仅做一次；
 * reset() 仅清承载面引用，不影响服务进程。
 *
 * 验收条件：
 * - open 首次调用注册侧栏对话 provider 并创建主编辑区输入 panel，两处 html 分别含 ?focus=conversation / ?focus=composer
 * - 再次 open 复用已注册 provider 与存活 panel（reveal），不重复注册/新建
 * - panel 关闭（onDidDispose）后再次 open 重建 panel
 * - stop/clean 调用 reset 清引用，不触碰服务
 * - 主区 panel 关闭、服务保持运行时 reset 不清服务引用
 */

'use strict';

const FOCUS_CHAT_VIEW_ID = 'opendsh.dsh-chat';
const FOCUS_INPUT_PANEL_ID = 'opendsh.dsh-focus-input';
const FOCUS_CONTAINER_CMD = 'workbench.view.extension.opendsh';
const FOCUS_VIEW_FOCUS_CMD = 'opendsh.dsh-chat.focus';

function createFocus(deps) {
  const detect = deps.detect;
  const webview = deps.webview;
  const vscode = deps.vscode;

  let providerRegistered = false;
  let sideView = null; // 最近一次 resolved 的侧栏对话 WebviewView
  let panel = null; // 主编辑区输入 WebviewPanel
  let urls = null; // { conversation, composer } 聚焦 URL

  function getUrls(config) {
    if (!urls) {
      urls = detect.buildFocusUrls(config.host, config.port);
    }
    return urls;
  }

  // 侧栏对话视图 provider：resolve 时把最新聚焦 URL 写进其 webview；provider 懒启动，DSH 界面由用户展开或 open 触发。
  function ensureSideProvider(config) {
    if (providerRegistered) return;
    const current = getUrls(config);
    const provider = {
      resolveWebviewView(webviewView) {
        sideView = webviewView;
        webviewView.webview.html = webview.buildWebviewHtml(current.conversation);
      },
      onDidChangeVisibility() {},
      onDidDispose() {
        sideView = null;
      },
    };
    vscode.window.registerWebviewViewProvider(FOCUS_CHAT_VIEW_ID, provider, {
      webviewOptions: { enableScripts: true, retainContextWhenHidden: true },
    });
    providerRegistered = true;
  }

  // 尝试打开/聚焦侧栏对话容器（VS Code 命令触发，不阻塞 open 主流程；命令缺失时静默忽略）。
  function revealSideView() {
    const cmds = [FOCUS_CONTAINER_CMD, FOCUS_VIEW_FOCUS_CMD];
    for (const cmd of cmds) {
      if (typeof vscode.commands.executeCommand === 'function') {
        try {
          const p = vscode.commands.executeCommand(cmd);
          if (p && typeof p.then === 'function') p.then(() => {}, () => {});
        } catch (err) {
          // 命令不存在或超时：不中断 open，留待用户手动展开侧栏视图
        }
      }
    }
  }

  function openMainPanel(config) {
    if (panel) {
      panel.reveal(vscode.ViewColumn.Active, false);
      return;
    }
    panel = vscode.window.createWebviewPanel(
      FOCUS_INPUT_PANEL_ID,
      'DSH Input',
      vscode.ViewColumn.Active,
      { enableScripts: true, retainContextWhenHidden: true }
    );
    panel.webview.html = webview.buildWebviewHtml(getUrls(config).composer);
    panel.onDidDispose(() => {
      panel = null; // 关主区输入标签页只清引用，服务不受影响
    });
  }

  function open(config) {
    ensureSideProvider(config);
    openMainPanel(config);
    revealSideView();
  }

  // 关闭/停止时清承载面引用（不触碰 dsh 服务进程）。存在未关闭的 panel/视图时由 VS Code 自行回收。
  function reset() {
    panel = null;
    sideView = null;
    urls = null;
  }

  return {
    open,
    reset,
    getState: () => ({ sideView: !!sideView, panel: !!panel, urls }),
  };
}

module.exports = { createFocus, FOCUS_CHAT_VIEW_ID, FOCUS_INPUT_PANEL_ID };
