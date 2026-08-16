/**
 * @intent
 * 聚焦打开模式的承载面编排：openWith=focus 时由 manager 委托本模块，创建/复用三个 WebviewPanel 承载面——
 * ① 会话选择区（?focus=sidebar 会话列表）；② 消息流（?focus=conversation.session）；
 * ③ 输入区（?focus=conversation.composer）。主编辑区承载，用户可拖拽分栏把 AI 对话放到代码旁边。
 * 三个 URL 由 detect.buildFocusUrls 按统一契约组装（sessions/conversation/composer 三值）；本模块只负责承载面的
 * 创建/复用/清理，不管理 dsh 服务进程（服务生命周期仍归 manager）。
 * 承载面由 VIEW_SPECS 描述表驱动：viewId + buildFocusUrls 的 key + panel 标题。
 * 采用 WebviewPanel 而非 WebviewView：VS Code 当前版本的 WebviewView（侧边栏/面板容器）内 iframe 加载外部 http
 * 会被透明化（VS Code 环境限制，见 issue #277136 同类问题），WebviewPanel 的 iframe 加载已验证正常。
 *
 * 边界：config 由调用方（manager 经 detect.resolveConfig）注入，本模块不校验 host/port/openWith；
 * detect 缺 buildFocusUrls 时立即抛错（契约缺失是装配错误，不允许静默）；
 * panel 存活则复用（reveal + 重写 html 反映最新 URL），关闭（onDidDispose）后清引用、下次 open 重建；
 * reset() 仅清承载面引用，不影响服务进程。
 *
 * 验收条件：
 * - open 按 VIEW_SPECS 创建/复用三个 WebviewPanel，html 含对应聚焦 URL
 * - 再次 open 复用存活 panel（不重复创建），关闭后再次 open 重建
 * - open 每次按当前 config 重建聚焦 URL（webviewHost 用于 webview 访问，服务管理 host 分离）
 * - stop/clean 调用 reset 清引用，不触碰服务
 */

'use strict';

// panel viewType（WebviewPanel 的 viewType 无需在 package.json 声明，仅作内部标识）
const FOCUS_SESSIONS_VIEW_ID = 'opendsh.dsh-sessions'; // 会话选择区
const FOCUS_CONVERSATION_VIEW_ID = 'opendsh.dsh-conversation'; // 消息流
const FOCUS_INPUT_VIEW_ID = 'opendsh.dsh-input'; // 输入区

// 承载面描述表：viewId（创建/复用）→ buildFocusUrls 的 key（URL 组装）→ panel 标题 → 所属编辑器组（列）
// 布局：上下分栏——上方组放会话列表 + 消息流（标签页），下方组放输入区（横贯底部，视觉=底部面板）
const VIEW_SPECS = [
  { viewId: FOCUS_SESSIONS_VIEW_ID, urlKey: 'sessions', title: 'DSH Sessions', column: 'One' },
  { viewId: FOCUS_CONVERSATION_VIEW_ID, urlKey: 'conversation', title: 'DSH Conversation', column: 'One' },
  { viewId: FOCUS_INPUT_VIEW_ID, urlKey: 'composer', title: 'DSH Input', column: 'Two' },
];

function createFocus(deps) {
  const detect = deps.detect;
  const webview = deps.webview;
  const vscode = deps.vscode;

  let panels = new Map(); // viewId -> WebviewPanel（存活时复用，关闭后删除）
  let urls = null; // { sessions, conversation, composer } 聚焦 URL（open 时按 config 重建）

  // 当前聚焦 URL：open 已重建则复用；否则从当前 opendsh 配置实时读 webviewHost/port 构建
  function currentUrls() {
    if (!urls) {
      const cfg = vscode.workspace.getConfiguration('opendsh');
      const host = typeof cfg.get('host') === 'string' && cfg.get('host') !== '' ? cfg.get('host') : '127.0.0.1';
      const webviewHost = typeof cfg.get('webviewHost') === 'string' && cfg.get('webviewHost') !== '' ? cfg.get('webviewHost') : host;
      const port = Number.isInteger(cfg.get('port')) ? cfg.get('port') : 3080;
      urls = detect.buildFocusUrls(webviewHost, port);
    }
    return urls;
  }

  // 设置编辑器布局为上下分栏：上方 70%（代码/消息流），下方 30%（输入区，横贯底部）。
  function applyLayout() {
    if (typeof vscode.commands.executeCommand !== 'function') return;
    vscode.commands.executeCommand('vscode.setEditorLayout', {
      orientation: 1, // 1 = 纵向（上下分栏）
      groups: [
        { size: 0.7, groups: [] },
        { size: 0.3, groups: [] },
      ],
    });
  }

  // 创建/复用全部承载面板，html 反映最新聚焦 URL；panel 关闭后下次 open 重建。
  function ensurePanels() {
    const current = urls;
    for (const spec of VIEW_SPECS) {
      let panel = panels.get(spec.viewId);
      if (!panel) {
        panel = vscode.window.createWebviewPanel(spec.viewId, spec.title, vscode.ViewColumn[spec.column], {
          enableScripts: true,
          retainContextWhenHidden: true,
        });
        panel.onDidDispose(() => {
          panels.delete(spec.viewId);
        });
        panels.set(spec.viewId, panel);
      }
      panel.webview.html = webview.buildWebviewHtml(current[spec.urlKey]);
      panel.reveal(vscode.ViewColumn[spec.column], false);
    }
  }

  function open(config) {
    urls = detect.buildFocusUrls(config.webviewHost, config.port); // 每次 open 按当前配置重建
    applyLayout();
    ensurePanels();
  }

  // 关闭/停止时清承载面引用（不触碰 dsh 服务进程）。存在未关闭的 panel 时由 VS Code 自行回收。
  function reset() {
    panels.clear();
    urls = null;
  }

  return {
    open,
    reset,
    getState: () => ({ panels: panels.size, urls }),
  };
}

module.exports = {
  createFocus,
  VIEW_SPECS,
  FOCUS_SESSIONS_VIEW_ID,
  FOCUS_CONVERSATION_VIEW_ID,
  FOCUS_INPUT_VIEW_ID,
};
