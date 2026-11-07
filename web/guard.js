/* ============================================================================
   桌面外壳防护层（加载时机最早，先于业务脚本）
   目的：让程序表现得像原生桌面软件，不暴露“这是个网页”的任何痕迹

   1. 屏蔽右键菜单（行情输入框内保留原生菜单，方便粘贴代码）
   2. 屏蔽开发者工具 / 查看源码 / 打印 / 另存为 / 刷新 / 页内查找 / 缩放
   3. 屏蔽新建标签页、地址栏、历史、下载、后退等浏览器导航行为
   4. 禁止选中文字、拖拽图片、拖放文件、中键自动滚动
   5. 拦截 Ctrl+滚轮 缩放（缩放后一眼就能看出是网页）

   注意：只 preventDefault，不做 stopPropagation，
   否则会打断画线模块的右键取消落点、Ctrl+Z 撤销、Ctrl+R 刷新行情。
   ========================================================================== */
(function () {
  'use strict';

  var doc = document;
  var win = window;

  /* 标记：外壳层已生效（便于自动化自检，不影响界面） */
  try { doc.documentElement.setAttribute('data-ui', 'native'); } catch (e) { }

  /* 判断事件目标是否是可输入元素（输入框里要保留系统的复制/粘贴/全选行为） */
  function editable(el) {
    while (el && el.nodeType === 1) {
      var tag = (el.tagName || '').toUpperCase();
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
      if (el.isContentEditable) return true;
      if (el === doc.body) return false;
      el = el.parentNode;
    }
    return false;
  }

  /* ------------------------------------------------ 1. 右键菜单 */
  doc.addEventListener('contextmenu', function (e) {
    if (editable(e.target)) return;      /* 输入框放行 */
    e.preventDefault();
    return false;
  }, true);

  /* ------------------------------------------------ 2. 选中 / 拖拽 / 拖放 */
  doc.addEventListener('selectstart', function (e) {
    if (!editable(e.target)) e.preventDefault();
  }, true);

  doc.addEventListener('dragstart', function (e) {
    e.preventDefault();
  }, true);

  doc.addEventListener('dragover', function (e) {
    e.preventDefault();
  }, true);

  doc.addEventListener('drop', function (e) {
    e.preventDefault();
  }, true);

  /* 中键：浏览器会进入滚动模式 / 新标签打开 */
  doc.addEventListener('mousedown', function (e) {
    if (e.button === 1) e.preventDefault();
  }, true);
  doc.addEventListener('auxclick', function (e) {
    if (e.button === 1) e.preventDefault();
  }, true);

  /* ------------------------------------------------ 3. 快捷键 */
  var FN_BLOCK = { F1: 1, F3: 1, F5: 1, F6: 1, F7: 1, F12: 1 };

  /* Ctrl + 单键：查看源码 / 保存 / 打印 / 打开 / 历史 / 下载 / 收藏
     地址栏 / 新建标签 / 新建窗口 / 页内查找 / 缩放 / 全选 */
  var CTRL_BLOCK = {
    u: 1, s: 1, p: 1, o: 1, h: 1, j: 1, d: 1, l: 1, n: 1, t: 1,
    f: 1, g: 1, a: 1, r: 1, '0': 1, '-': 1, '=': 1, '+': 1, tab: 1
  };

  /* Ctrl + Shift + 键：开发者工具 / 任务管理器 / 清除数据 / 书签管理器 /
     标签页搜索 / 静音 / 退出 / 打印 / 无痕窗口 */
  var CTRL_SHIFT_BLOCK = {
    i: 1, j: 1, c: 1, k: 1, b: 1, m: 1, q: 1, p: 1,
    delete: 1, n: 1, t: 1, w: 1, o: 1
  };

  /* Alt + 键：前进 / 后退 / 主页 / 聚焦地址栏 */
  var ALT_BLOCK = { arrowleft: 1, arrowright: 1, home: 1, d: 1, f: 1, e: 1 };

  doc.addEventListener('keydown', function (e) {
    var key = e.key || '';
    var low = key.toLowerCase();
    var typing = editable(e.target);
    var hit = false;

    if (FN_BLOCK[key.toUpperCase()]) {
      hit = true;
    } else if (e.ctrlKey && e.shiftKey && CTRL_SHIFT_BLOCK[low]) {
      hit = true;
    } else if (e.ctrlKey && !e.shiftKey && CTRL_BLOCK[low]) {
      hit = true;
    } else if (e.altKey && !e.ctrlKey && ALT_BLOCK[low]) {
      hit = true;
    } else if (e.shiftKey && key === 'F10') {
      hit = true;                       /* 键盘唤出右键菜单 */
    } else if (key === 'Backspace' && !typing) {
      hit = true;                       /* 后退 */
    }

    /* 输入框里要保留：全选 / 撤销 / 剪切 / 复制 / 粘贴 */
    if (typing && (low === 'a' || low === 'z' || low === 'x' || low === 'v' || low === 'c')) {
      hit = false;
    }
    /* Esc 关闭弹窗、Ctrl+Z 撤销画线 —— 放行
       Ctrl+R 只拦截浏览器刷新（页面不重载），业务脚本仍能收到事件去刷新行情 */
    if (key === 'Escape' || low === 'z') return;

    if (hit) {
      e.preventDefault();
      return false;
    }
  }, true);

  /* ------------------------------------------------ 4. Ctrl + 滚轮缩放 */
  win.addEventListener('wheel', function (e) {
    if (e.ctrlKey) e.preventDefault();
  }, { passive: false, capture: true });

  /* ------------------------------------------------ 5. 屏蔽 window.open / 打印 */
  win.open = function () { return null; };
  win.print = function () { };
})();
