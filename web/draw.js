/* ===================== 画线工具（参考通达信画线工具） =====================
 * 覆盖在 K 线主图上的独立 Canvas 图层。
 * 所有画线以「时间 + 价格」为锚点存储，缩放/平移/换数据都不会错位。
 */
(function (global) {
  'use strict';

  var NEED = {
    trend: 2, ray: 2, line: 2, hline: 1, vline: 1,
    channel: 3, rect: 2, fib: 2, cycle: 2, arrow: 2, text: 1,
  };

  var TOOL_TIP = {
    select: '光标：点击选中画线，拖动移动，Delete 删除',
    trend: '趋势线：在图上点击两个点',
    ray: '射线：点击起点、方向点',
    line: '直线：点击两个点（两端无限延伸）',
    hline: '水平线：点击一个价位（可自动吸附开高低收）',
    vline: '垂直线：点击一根 K 线',
    channel: '平行通道：点击基线两点，再点第三点定宽度',
    rect: '矩形：点击两个对角点',
    fib: '黄金分割：点击起点价、终点价',
    cycle: '周期线：点击两个点，按间距画等距竖线',
    arrow: '箭头：点击起点、箭头位置',
    text: '文字标注：点击位置后输入文字',
  };

  var FIB = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
  var FONT = '10px "Microsoft YaHei UI","Microsoft YaHei",sans-serif';
  var KEY = 'futures_pro_draw_v1';

  /* ------------------------------------------------------------ 几何工具 */
  function dist2seg(px, py, x1, y1, x2, y2) {
    var dx = x2 - x1, dy = y2 - y1;
    var len = dx * dx + dy * dy;
    var t = len ? ((px - x1) * dx + (py - y1) * dy) / len : 0;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
  }

  /* Liang-Barsky：把参数直线裁剪到矩形内 */
  function clipSeg(a, b, rect, t0, t1) {
    var dx = b[0] - a[0], dy = b[1] - a[1];
    if (!dx && !dy) return null;
    var p = [-dx, dx, -dy, dy];
    var q = [a[0] - rect.x, rect.x + rect.width - a[0],
             a[1] - rect.y, rect.y + rect.height - a[1]];
    for (var i = 0; i < 4; i++) {
      if (p[i] === 0) { if (q[i] < 0) return null; }
      else {
        var r = q[i] / p[i];
        if (p[i] < 0) { if (r > t1) return null; if (r > t0) t0 = r; }
        else { if (r < t0) return null; if (r < t1) t1 = r; }
      }
    }
    if (t0 > t1) return null;
    return [a[0] + t0 * dx, a[1] + t0 * dy, a[0] + t1 * dx, a[1] + t1 * dy];
  }

  function hexA(hex, a) {
    var h = String(hex || '#e0b155').replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var n = parseInt(h, 16);
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
  }

  /* ============================================================ 图层实现 */
  global.createDrawLayer = function (cfg) {
    var host = cfg.host;                       // ECharts 容器
    var canvas = cfg.canvas;                   // 覆盖画布
    var ctx = canvas.getContext('2d');
    var getChart = cfg.getChart;
    var getBars = cfg.getBars;
    var onHint = cfg.onHint || function () { };
    var onLockPan = cfg.onLockPan || function () { };

    var st = {
      tool: 'select', visible: true, color: '#e0b155', w: 1,
      placing: [], mouse: null, sel: -1, drag: null, key: '',
    };
    var items = [];
    var hist = [];
    var memo = { n: -1, first: '', map: null };
    var raf = null;
    var textBox = null;

    /* ---------------- 数据 → 像素 ---------------- */
    function bars() { return getBars() || []; }

    function buildMemo() {
      var bs = bars();
      var map = new Map();
      for (var i = 0; i < bs.length; i++) map.set(bs[i].t, i);
      memo = { n: bs.length, first: bs[0] ? bs[0].t : '', map: map };
    }

    function idxOf(t) {
      var bs = bars();
      if (!bs.length) return -1;
      if (memo.n !== bs.length || memo.first !== (bs[0] ? bs[0].t : '')) buildMemo();
      var i = memo.map.get(t);
      if (i !== undefined) return i;
      // 时间不在当前数据里：二分找最近
      var lo = 0, hi = bs.length - 1;
      while (lo < hi) {
        var mid = (lo + hi) >> 1;
        if (bs[mid].t < t) lo = mid + 1; else hi = mid;
      }
      return lo;
    }

    function toPx(pt) {
      var chart = getChart();
      if (!chart || !pt) return null;
      var i = idxOf(pt.t);
      if (i < 0) return null;
      var x, y;
      try {
        x = chart.convertToPixel({ xAxisIndex: 0 }, i);
        y = chart.convertToPixel({ yAxisIndex: 0 }, pt.p);
      } catch (e) { return null; }
      if (x == null || y == null || !isFinite(x) || !isFinite(y)) return null;
      return [x, y];
    }

    function fromPx(x, y, snapPrice) {
      var chart = getChart();
      var bs = bars();
      if (!chart || !bs.length) return null;
      var v;
      try { v = chart.convertFromPixel({ xAxisIndex: 0, yAxisIndex: 0 }, [x, y]); }
      catch (e) { return null; }
      if (!v || !isFinite(v[0]) || !isFinite(v[1])) return null;
      var i = Math.max(0, Math.min(bs.length - 1, Math.round(v[0])));
      var p = v[1];
      if (snapPrice) {
        var cands = [bs[i].o, bs[i].h, bs[i].l, bs[i].c], best = p, bd = 7;
        for (var k = 0; k < cands.length; k++) {
          if (cands[k] == null) continue;
          var py;
          try { py = chart.convertToPixel({ yAxisIndex: 0 }, cands[k]); } catch (e) { continue; }
          var d = Math.abs(py - y);
          if (d < bd) { bd = d; best = cands[k]; }
        }
        p = best;
      }
      return { t: bs[i].t, p: p, i: i };
    }

    function gridRect() {
      var chart = getChart();
      if (!chart) return null;
      try {
        var g = chart.getModel().getComponent('grid', 0);
        var r = g && g.coordinateSystem && g.coordinateSystem.getRect();
        if (r && r.width > 4 && r.height > 4) return r;
      } catch (e) { }
      var w = host.clientWidth || 800, h = host.clientHeight || 600;
      return { x: 14, y: 40, width: w - 88, height: h * 0.5 };
    }

    /* ---------------- 绘制基础 ---------------- */
    function seg(a, b) {
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
    }
    function seg2(r) {
      ctx.beginPath(); ctx.moveTo(r[0], r[1]); ctx.lineTo(r[2], r[3]); ctx.stroke();
    }
    function line2(x1, y1, x2, y2) {
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    }
    function rrect(x, y, w, h, r) {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
      ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
      ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
      ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
      ctx.closePath();
    }
    function tag(x, y, text, color, align) {
      ctx.save();
      ctx.font = FONT;
      ctx.shadowBlur = 0;
      var w = ctx.measureText(text).width + 8;
      var bx = align === 'right' ? x - w : x;
      ctx.fillStyle = 'rgba(9,13,19,.82)';
      rrect(bx, y - 1, w, 15, 3);
      ctx.fill();
      ctx.fillStyle = color || '#e0b155';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, bx + 4, y + 7);
      ctx.restore();
    }
    function arrowHead(a, b) {
      var ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
      var L = 9;
      ctx.beginPath();
      ctx.moveTo(b[0], b[1]);
      ctx.lineTo(b[0] - L * Math.cos(ang - 0.38), b[1] - L * Math.sin(ang - 0.38));
      ctx.moveTo(b[0], b[1]);
      ctx.lineTo(b[0] - L * Math.cos(ang + 0.38), b[1] - L * Math.sin(ang + 0.38));
      ctx.stroke();
    }
    function fmtP(v) {
      var a = Math.abs(v || 0);
      var d = a >= 1000 ? 1 : a >= 100 ? 2 : a >= 10 ? 2 : 3;
      return Number(v).toFixed(d);
    }
    function shortDate(t) {
      if (!t) return '';
      return t.length > 10 ? t.slice(5, 16) : t;
    }

    /* ---------------- 单个图形 ---------------- */
    function paint(d, rect, sel, ghost) {
      if (!d || !d.pts || !d.pts.length) return;
      var pts = [], i;
      for (i = 0; i < d.pts.length; i++) {
        var p = toPx(d.pts[i]);
        if (!p) return;
        pts.push(p);
      }
      var c = d.color || '#e0b155';
      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      if (ghost) ctx.globalAlpha = 0.75;
      ctx.strokeStyle = sel ? '#ffffff' : c;
      ctx.fillStyle = sel ? '#ffffff' : c;
      ctx.lineWidth = (d.w || 1) + (sel ? 0.5 : 0);
      if (sel) { ctx.shadowColor = c; ctx.shadowBlur = 8; }
      ctx.setLineDash([]);

      switch (d.type) {
        case 'trend':
          if (pts[1]) seg(pts[0], pts[1]);
          break;

        case 'ray': {
          var r1 = clipSeg(pts[0], pts[1], rect, 0, 1e9);
          if (r1) seg2(r1);
          break;
        }
        case 'line': {
          var r2 = clipSeg(pts[0], pts[1], rect, -1e9, 1e9);
          if (r2) seg2(r2);
          break;
        }
        case 'arrow':
          if (pts[1]) { seg(pts[0], pts[1]); arrowHead(pts[0], pts[1]); }
          break;

        case 'hline': {
          var hy = pts[0][1];
          if (hy < rect.y - 30 || hy > rect.y + rect.height + 30) break;
          ctx.setLineDash([5, 4]);
          line2(rect.x, hy, rect.x + rect.width, hy);
          ctx.setLineDash([]);
          if (!ghost) tag(rect.x + rect.width - 4, hy - 17, fmtP(d.pts[0].p), c, 'right');
          break;
        }
        case 'vline': {
          var vx = pts[0][0];
          ctx.setLineDash([5, 4]);
          line2(vx, rect.y, vx, rect.y + rect.height);
          ctx.setLineDash([]);
          if (!ghost) tag(vx + 3, rect.y + 2, shortDate(d.pts[0].t), c, 'left');
          break;
        }
        case 'channel': {
          if (!pts[2]) break;
          var a = pts[0], b = pts[1], pc = pts[2];
          var dx = b[0] - a[0], dy = b[1] - a[1];
          var L = Math.hypot(dx, dy) || 1;
          var nx = -dy / L, ny = dx / L;
          var off = (pc[0] - a[0]) * nx + (pc[1] - a[1]) * ny;
          var a2 = [a[0] + nx * off, a[1] + ny * off];
          var b2 = [b[0] + nx * off, b[1] + ny * off];
          var s1 = clipSeg(a, b, rect, -1e9, 1e9);
          var s2 = clipSeg(a2, b2, rect, -1e9, 1e9);
          if (s1 && s2) {
            ctx.save();
            ctx.shadowBlur = 0;
            ctx.fillStyle = hexA(c, 0.08);
            ctx.beginPath();
            ctx.moveTo(s1[0], s1[1]); ctx.lineTo(s1[2], s1[3]);
            ctx.lineTo(s2[2], s2[3]); ctx.lineTo(s2[0], s2[1]);
            ctx.closePath(); ctx.fill();
            ctx.restore();
          }
          if (s1) seg2(s1);
          if (s2) { ctx.setLineDash([4, 3]); seg2(s2); ctx.setLineDash([]); }
          break;
        }
        case 'rect': {
          if (!pts[1]) break;
          var x1 = Math.min(pts[0][0], pts[1][0]), x2 = Math.max(pts[0][0], pts[1][0]);
          var y1 = Math.min(pts[0][1], pts[1][1]), y2 = Math.max(pts[0][1], pts[1][1]);
          ctx.save();
          ctx.shadowBlur = 0;
          ctx.fillStyle = hexA(c, 0.09);
          ctx.fillRect(x1, y1, x2 - x1, y2 - y1);
          ctx.restore();
          ctx.strokeRect(x1 + .5, y1 + .5, Math.max(1, x2 - x1 - 1), Math.max(1, y2 - y1 - 1));
          if (!ghost) {
            var p0 = d.pts[0].p, p1 = d.pts[1].p;
            var pct = p0 ? (p1 - p0) / p0 * 100 : 0;
            tag(x2 - 4, y1 + 4, (pct >= 0 ? '+' : '') + pct.toFixed(2) + '%  ' + fmtP(Math.abs(p1 - p0)), c, 'right');
          }
          break;
        }
        case 'fib': {
          if (!pts[1]) break;
          var v0 = d.pts[0].p, v1 = d.pts[1].p;
          var lastLab = -999;
          for (var f = 0; f < FIB.length; f++) {
            var lv = FIB[f];
            var pv = v0 + (v1 - v0) * lv;
            var pp = toPx({ t: d.pts[0].t, p: pv });
            if (!pp) continue;
            var yy = pp[1];
            if (yy < rect.y - 2 || yy > rect.y + rect.height + 2) continue;
            var major = (lv === 0 || lv === 0.5 || lv === 1);
            ctx.globalAlpha = ghost ? 0.6 : (major ? 1 : 0.72);
            ctx.lineWidth = (d.w || 1) * (major ? 1 : 0.9);
            ctx.setLineDash(major ? [] : [4, 3]);
            line2(rect.x, yy, rect.x + rect.width, yy);
            ctx.setLineDash([]);
            ctx.globalAlpha = ghost ? 0.6 : 1;
            // 标签过密时跳过高位标签，避免相互覆盖
            if (!ghost && Math.abs(yy - lastLab) >= 13) {
              tag(rect.x + rect.width - 4, yy - 16, (lv * 100).toFixed(1) + '%  ' + fmtP(pv), c, 'right');
              lastLab = yy;
            }
          }
          ctx.globalAlpha = 1;
          break;
        }
        case 'cycle': {
          if (!pts[1]) break;
          var i0 = idxOf(d.pts[0].t), i1 = idxOf(d.pts[1].t);
          var step = Math.abs(i1 - i0) || 1;
          var bs = bars();
          var lx = fromPx(rect.x, rect.y, false), rx = fromPx(rect.x + rect.width, rect.y, false);
          if (!lx || !rx) break;
          var lo = Math.min(lx.i, rx.i) - 1, hi = Math.max(lx.i, rx.i) + 1;
          var k0 = Math.floor((lo - i0) / step), k1 = Math.ceil((hi - i0) / step);
          if (k1 - k0 > 260) k1 = k0 + 260;
          for (var kk = k0; kk <= k1; kk++) {
            var idx = i0 + kk * step;
            if (idx < 0 || idx >= bs.length) continue;
            var xp = toPx({ t: bs[idx].t, p: d.pts[0].p });
            if (!xp) continue;
            ctx.globalAlpha = ghost ? 0.6 : (kk === 0 ? 1 : 0.5);
            ctx.setLineDash(kk % 5 === 0 ? [] : [3, 4]);
            line2(xp[0], rect.y, xp[0], rect.y + rect.height);
          }
          ctx.setLineDash([]);
          ctx.globalAlpha = 1;
          break;
        }
        case 'text': {
          var txt = d.text || '文字';
          ctx.font = FONT;
          ctx.shadowBlur = 0;
          var tw = ctx.measureText(txt).width;
          var bx = pts[0][0], by = pts[0][1];
          ctx.fillStyle = sel ? 'rgba(255,255,255,.16)' : hexA(c, 0.16);
          rrect(bx - 3, by - 13, tw + 9, 18, 3);
          ctx.fill();
          ctx.strokeStyle = sel ? '#fff' : hexA(c, 0.75);
          ctx.lineWidth = 1;
          ctx.stroke();
          ctx.fillStyle = sel ? '#fff' : c;
          ctx.textAlign = 'left';
          ctx.textBaseline = 'middle';
          ctx.fillText(txt, bx + 1, by - 3);
          break;
        }
      }
      ctx.restore();
    }

    function paintHandles(d, rect) {
      var pts = (d.pts || []).map(toPx);
      ctx.save();
      ctx.shadowBlur = 0;
      for (var i = 0; i < pts.length; i++) {
        if (!pts[i]) continue;
        ctx.beginPath();
        ctx.rect(pts[i][0] - 3, pts[i][1] - 3, 6, 6);
        ctx.fillStyle = '#0a0d13';
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }
      ctx.restore();
    }

    /* ---------------- 预览 ---------------- */
    function buildPreview() {
      var need = NEED[st.tool];
      if (!need || !st.mouse) return null;
      var pts = st.placing.slice();
      var mp = fromPx(st.mouse[0], st.mouse[1], false);
      if (!mp) return null;
      var anchor = { t: mp.t, p: mp.p };
      while (pts.length < need) pts.push(anchor);
      return { type: st.tool, pts: pts, color: st.color, w: st.w };
    }

    /* ---------------- 主渲染 ---------------- */
    function render() {
      var w = host.clientWidth, h = host.clientHeight;
      if (!w || !h) return;
      var dpr = global.devicePixelRatio || 1;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
        canvas.style.width = w + 'px';
        canvas.style.height = h + 'px';
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      var chart = getChart();
      if (!st.visible || !chart || !bars().length) return;
      var rect = gridRect();
      if (!rect) return;

      var prev = buildPreview();
      var list = items.slice();
      if (prev) list.push(prev);

      ctx.save();
      ctx.beginPath();
      ctx.rect(rect.x, rect.y, rect.width, rect.height);
      ctx.clip();
      for (var k = 0; k < list.length; k++) {
        paint(list[k], rect, k === st.sel && !prev, k === list.length - 1 && !!prev);
      }
      ctx.restore();

      if (st.sel >= 0 && items[st.sel] && !prev) paintHandles(items[st.sel], rect);
    }

    function bump() {
      if (raf) return;
      raf = requestAnimationFrame(function () { raf = null; render(); });
    }

    /* ---------------- 存储 ---------------- */
    function readAll() {
      try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { return {}; }
    }
    function save() {
      if (!st.key) return;
      try {
        var o = readAll();
        if (items.length) o[st.key] = items; else delete o[st.key];
        localStorage.setItem(KEY, JSON.stringify(o));
      } catch (e) { }
    }
    function setContext(code, tf) {
      save();
      st.key = String(code || '') + '|' + String(tf || '');
      var o = readAll();
      items = Array.isArray(o[st.key]) ? o[st.key] : [];
      hist = [];
      st.sel = -1;
      st.placing = [];
      bump();
      onHint(TOOL_TIP[st.tool] || '');
    }
    function snapshot() {
      hist.push(JSON.stringify(items));
      if (hist.length > 40) hist.shift();
    }

    /* ---------------- 命中检测 ---------------- */
    function hitTest(x, y) {
      var rect = gridRect();
      var best = -1, bd = 7;
      for (var k = items.length - 1; k >= 0; k--) {
        var d = items[k];
        var pts = (d.pts || []).map(toPx);
        var ok = true, i;
        for (i = 0; i < pts.length; i++) if (!pts[i]) { ok = false; break; }
        if (!ok || !pts.length) continue;
        var dd = 1e9;
        switch (d.type) {
          case 'trend': case 'arrow':
            if (pts[1]) dd = dist2seg(x, y, pts[0][0], pts[0][1], pts[1][0], pts[1][1]);
            break;
          case 'ray': {
            if (!pts[1]) break;
            var ux = pts[1][0] - pts[0][0], uy = pts[1][1] - pts[0][1];
            var L = Math.hypot(ux, uy) || 1;
            dd = dist2seg(x, y, pts[0][0], pts[0][1], pts[0][0] + ux / L * 4000, pts[0][1] + uy / L * 4000);
            break;
          }
          case 'line': {
            if (!pts[1]) break;
            var ux2 = pts[1][0] - pts[0][0], uy2 = pts[1][1] - pts[0][1];
            var L2 = Math.hypot(ux2, uy2) || 1;
            dd = dist2seg(x, y, pts[0][0] - ux2 / L2 * 4000, pts[0][1] - uy2 / L2 * 4000,
              pts[0][0] + ux2 / L2 * 4000, pts[0][1] + uy2 / L2 * 4000);
            break;
          }
          case 'hline': dd = Math.abs(y - pts[0][1]); break;
          case 'vline': dd = Math.abs(x - pts[0][0]); break;
          case 'channel': {
            if (!pts[2]) break;
            var a = pts[0], b = pts[1], pc = pts[2];
            var dx = b[0] - a[0], dy = b[1] - a[1];
            var LL = Math.hypot(dx, dy) || 1;
            var nx = -dy / LL, ny = dx / LL;
            var off = (pc[0] - a[0]) * nx + (pc[1] - a[1]) * ny;
            dd = Math.min(
              dist2seg(x, y, a[0] - dx * 40, a[1] - dy * 40, b[0] + dx * 40, b[1] + dy * 40),
              dist2seg(x, y, a[0] + nx * off - dx * 40, a[1] + ny * off - dy * 40,
                b[0] + nx * off + dx * 40, b[1] + ny * off + dy * 40)
            );
            break;
          }
          case 'rect': {
            var x1 = Math.min(pts[0][0], pts[1][0]), x2 = Math.max(pts[0][0], pts[1][0]);
            var y1 = Math.min(pts[0][1], pts[1][1]), y2 = Math.max(pts[0][1], pts[1][1]);
            if (x >= x1 - 5 && x <= x2 + 5 && y >= y1 - 5 && y <= y2 + 5) {
              dd = Math.min(dist2seg(x, y, x1, y1, x2, y1), dist2seg(x, y, x2, y1, x2, y2),
                dist2seg(x, y, x2, y2, x1, y2), dist2seg(x, y, x1, y2, x1, y1));
              dd = Math.min(dd, 0.6);   // 内部也可选中
            }
            break;
          }
          case 'fib': {
            var v0 = d.pts[0].p, v1 = d.pts[1].p;
            for (var f = 0; f < FIB.length; f++) {
              var pp = toPx({ t: d.pts[0].t, p: v0 + (v1 - v0) * FIB[f] });
              if (!pp) continue;
              dd = Math.min(dd, Math.abs(y - pp[1]));
            }
            break;
          }
          case 'cycle': {
            var i0 = idxOf(d.pts[0].t), i1 = idxOf(d.pts[1].t);
            var step = Math.abs(i1 - i0) || 1;
            var bs2 = bars();
            for (var kk = -400; kk <= 400; kk++) {
              var idx = i0 + kk * step;
              if (idx < 0 || idx >= bs2.length) continue;
              var xp = toPx({ t: bs2[idx].t, p: d.pts[0].p });
              if (!xp) continue;
              var dxp = Math.abs(x - xp[0]);
              if (dxp < dd) dd = dxp;
            }
            break;
          }
          case 'text': {
            ctx.save();
            ctx.font = FONT;
            var tw = ctx.measureText(d.text || '文字').width;
            ctx.restore();
            if (x >= pts[0][0] - 5 && x <= pts[0][0] + tw + 6 && y >= pts[0][1] - 16 && y <= pts[0][1] + 4) dd = 0;
            break;
          }
        }
        if (dd < bd) { bd = dd; best = k; }
      }
      return best;
    }

    /* ---------------- 交互 ---------------- */
    function pos(e) {
      var r = host.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top];
    }

    function inGrid(x, y) {
      var r = gridRect();
      return r && x >= r.x - 4 && x <= r.x + r.width + 4 && y >= r.y - 4 && y <= r.y + r.height + 4;
    }

    function setCursor() {
      if (st.tool === 'select') host.style.cursor = st.sel >= 0 ? 'move' : '';
      else host.style.cursor = 'crosshair';
    }

    function commit() {
      var need = NEED[st.tool];
      if (st.placing.length < need) return;
      var d = { type: st.tool, pts: st.placing.slice(0, need), color: st.color, w: st.w };
      snapshot();
      items.push(d);
      st.placing = [];
      save();
      bump();
      onHint(TOOL_TIP[st.tool] || '');
    }

    function onDown(e) {
      if (e.button !== 0) return;
      var p = pos(e);
      if (!inGrid(p[0], p[1])) return;

      if (st.tool === 'select') {
        var hit = hitTest(p[0], p[1]);
        st.sel = hit;
        if (hit >= 0) {
          snapshot();
          var start = fromPx(p[0], p[1], false);
          st.drag = { start: start, orig: JSON.parse(JSON.stringify(items[hit].pts)) };
          onLockPan(true);
          e.preventDefault();
          e.stopPropagation();
        }
        setCursor();
        bump();
        return;
      }

      var pt = fromPx(p[0], p[1], true);
      if (!pt) return;
      e.preventDefault();
      e.stopPropagation();

      if (st.tool === 'text') {
        st.placing = [{ t: pt.t, p: pt.p }];
        bump();
        openText(p[0], p[1], function (v) {
          snapshot();
          items.push({ type: 'text', pts: st.placing.slice(), color: st.color, w: st.w, text: v });
          st.placing = [];
          save();
          bump();
          onHint(TOOL_TIP[st.tool] || '');
        }, function () { st.placing = []; bump(); });
        return;
      }

      st.placing.push({ t: pt.t, p: pt.p });
      if (st.placing.length >= NEED[st.tool]) commit();
      else bump();
    }

    function onMove(e) {
      var p = pos(e);
      if (st.drag) {
        var cur = fromPx(p[0], p[1], false);
        if (!cur || !st.drag.start) return;
        var di = cur.i - st.drag.start.i, dp = cur.p - st.drag.start.p;
        var bs = bars();
        items[st.sel].pts = st.drag.orig.map(function (q) {
          var ni = Math.max(0, Math.min(bs.length - 1, idxOf(q.t) + di));
          return { t: bs[ni].t, p: q.p + dp };
        });
        bump();
        return;
      }
      if (st.placing.length) {
        st.mouse = p;
        bump();
      } else if (st.tool === 'select') {
        var hit = hitTest(p[0], p[1]);
        if ((hit >= 0) !== (st.sel >= 0) || (hit >= 0 && hit !== st.sel)) {
          st.sel = hit >= 0 ? hit : -1;
          setCursor();
          bump();
        }
      }
    }

    function onUp() {
      if (st.drag) {
        st.drag = null;
        onLockPan(false);
        save();
        bump();
      }
    }

    function onCtx(e) {
      if (st.placing.length) {
        e.preventDefault();
        st.placing = [];
        bump();
        onHint(TOOL_TIP[st.tool] || '');
      }
    }

    function onLeave() {
      if (st.placing.length && st.mouse) { st.mouse = null; bump(); }
    }

    /* 文字输入框 */
    function openText(x, y, ok, cancel) {
      if (textBox && textBox.parentNode) textBox.parentNode.removeChild(textBox);
      var box = document.createElement('div');
      box.className = 'draw-text-box';
      box.style.left = Math.max(4, x) + 'px';
      box.style.top = Math.max(4, y - 30) + 'px';
      box.innerHTML = '<input type="text" maxlength="48" placeholder="输入文字，回车确认">';
      host.parentNode.appendChild(box);
      var input = box.querySelector('input');
      textBox = box;
      setTimeout(function () { try { input.focus(); } catch (e) { } }, 20);
      function close() {
        if (box.parentNode) box.parentNode.removeChild(box);
        if (textBox === box) textBox = null;
      }
      input.addEventListener('keydown', function (ev) {
        ev.stopPropagation();
        if (ev.key === 'Enter') { var v = input.value.trim(); close(); if (v) ok(v); else cancel(); }
        else if (ev.key === 'Escape') { close(); cancel(); }
      });
      input.addEventListener('blur', function () { setTimeout(function () { if (textBox === box) { close(); cancel(); } }, 150); });
    }

    host.addEventListener('mousedown', onDown, true);
    host.addEventListener('mousemove', onMove, true);
    host.addEventListener('mouseleave', onLeave, true);
    host.addEventListener('contextmenu', onCtx, true);
    global.addEventListener('mouseup', onUp, true);
    global.addEventListener('blur', onUp, true);

    /* ---------------- 公开 API ---------------- */
    return {
      setContext: setContext,
      redraw: bump,
      renderNow: render,
      setTool: function (t) {
        if (!(t in TOOL_TIP)) return;
        st.tool = t;
        st.placing = [];
        st.sel = -1;
        st.drag = null;
        setCursor();
        bump();
        onHint(TOOL_TIP[t]);
      },
      getTool: function () { return st.tool; },
      setColor: function (c) { st.color = c; if (st.sel >= 0 && items[st.sel]) { items[st.sel].color = c; save(); bump(); } },
      setWidth: function (w) { st.w = w; if (st.sel >= 0 && items[st.sel]) { items[st.sel].w = w; save(); bump(); } },
      setVisible: function (v) { st.visible = !!v; bump(); },
      isVisible: function () { return st.visible; },
      undo: function () {
        if (!hist.length) return false;
        items = JSON.parse(hist.pop());
        st.sel = -1;
        save();
        bump();
        return true;
      },
      clearAll: function () {
        if (!items.length) return false;
        snapshot();
        items = [];
        st.sel = -1;
        save();
        bump();
        return true;
      },
      removeSelected: function () {
        if (st.sel < 0 || !items[st.sel]) return false;
        snapshot();
        items.splice(st.sel, 1);
        st.sel = -1;
        save();
        bump();
        return true;
      },
      hasSelection: function () { return st.sel >= 0; },
      cancel: function () {
        var had = st.placing.length > 0;
        st.placing = [];
        st.sel = -1;
        bump();
        return had;
      },
      count: function () { return items.length; },
      hitTest: hitTest,
    };
  };
})(window);
