/**
 * @intent
 * 实验版静默后台的补丁配角：定位 dsh-subprocess-local 目标文件、检测 windowsHide 补丁是否已应用、
 * 生成一条可在 VS Code 集成终端直接执行的「最短、自包含、幂等」补丁命令（buildScript 产出内联脚本，buildPatchCommand 包成 node -e 命令）。
 *
 * 边界：补丁仅 win32 语义——非 win32 或无 APPDATA 时 locateTarget 返回 null（视为 no-op），buildScript/buildPatchCommand 返回空串；
 * 定位默认 npm 全局布局（@deepseek-ai/dsh-subprocess-local/lib/index.js），deps.dshRoot 显式给定则从其同级 node_modules 推导；
 * isApplied 读不到文件返回 false（交由调用方决定）；生成的命令用 node -e 单行、PowerShell 单引号包裹、脚本内全双引号（无单引号），
 * 幂等（已含补丁则输出 already patched 并跳过写）；路径与字符串经 JSON.stringify 内插，脚本内不手写反斜杠转义。
 *
 * 验收条件：
 * - locateTarget 对 deps.dshRoot 返回 dsh-subprocess-local/lib/index.js 同级路径；非 win32 返回 null
 * - isApplied 对含 windowsHide 文本返回 true、不含返回 false、文件不存在返回 false
 * - buildScript 返回不含单引号的脚本串（内插目标路径）；定位失败返回 ''
 * - buildPatchCommand 返回以 node -e 开头、单引号包裹 buildScript 的命令；定位失败返回 ''
 * - 命令经 node 执行：对未打文件写补丁（含 windowsHide）、对已打文件幂等跳过（不重复写）
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const WINDOWS_HIDE_LITERAL = 'windowsHide: platform === "win32"';

// 定位补丁目标文件：deps.dshRoot 显式给定则从其同级 node_modules 推导；否则 APPDATA 下 npm 全局默认布局。
function locateTarget(deps) {
  const d = deps || {};
  const isWin = typeof d.isWin === 'boolean' ? d.isWin : process.platform === 'win32';
  if (!isWin) return null;
  if (d.dshRoot) {
    return path.join(d.dshRoot, '..', '..', 'dsh-subprocess-local', 'lib', 'index.js');
  }
  const env = d.env || process.env;
  const appData = env.APPDATA || (isWin ? path.join(os.homedir(), 'AppData', 'Roaming') : null);
  if (!appData) return null;
  return path.join(appData, 'npm', 'node_modules', '@deepseek-ai', 'dsh-subprocess-local', 'lib', 'index.js');
}

// 检测补丁是否已应用：读不到文件视为未打（返回 false）。
function isApplied(deps) {
  const file = locateTarget(deps);
  if (!file) return false;
  try {
    return fs.readFileSync(file, 'utf8').includes(WINDOWS_HIDE_LITERAL);
  } catch (err) {
    return false;
  }
}

// 生成内联补丁脚本（node -e 的源码参数）：脚本内全双引号、无反斜杠字面（路径/字符串经 JSON.stringify 内插）。
function buildScript(deps) {
  const file = locateTarget(deps);
  if (!file) return '';
  const j = (s) => JSON.stringify(s);
  const q = String.fromCharCode(34); // 双引号
  const tab = String.fromCharCode(9); // 制表符（放进字符类匹配缩进空格/制表符）
  const winHide = 'windowsHide: platform === ' + q + 'win32' + q;
  const detachedLine = 'detached: platform !== ' + q + 'win32' + q;
  const regexSource = '^([ ' + tab + ']*)' + detachedLine + '(,)?[ ' + tab + ']*$';

  const script =
    'var fs=require("fs");' +
    'var f=' + j(file) + ';' +
    'var s=fs.readFileSync(f,"utf8");' +
    'var H=' + j(winHide) + ';' +
    'if(s.indexOf(H)>=0){console.log("[already patched] "+f);process.exit(0);}' +
    'var R=new RegExp(' + j(regexSource) + ',"m");' +
    'if(!R.test(s)){console.error("patch target changed: detached line not found");process.exit(1);}' +
    'var NL=String.fromCharCode(10);' +
    'fs.writeFileSync(f,s.replace(R,function(_,i){return i+' + j(detachedLine) + '+","+NL+i+H;}),"utf8");' +
    'console.log("[patched] "+f)';
  return script;
}

// 完整补丁命令：PowerShell 单引号包裹脚本（脚本内无单引号），供 createTerminal 直接执行。
function buildPatchCommand(deps) {
  const script = buildScript(deps);
  if (!script) return '';
  return "node -e '" + script + "'";
}

module.exports = { locateTarget, isApplied, buildScript, buildPatchCommand };