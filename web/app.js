/* ===================== 期货分析系统 · 前端主逻辑 ===================== */
(function () {
  'use strict';

  const UP = '#f6465d';        // 涨（红）
  const DOWN = '#0ecb81';      // 跌（绿）
  const GOLD = '#e0b155';
  const BLUE = '#4c8dff';
  const MUTED = '#6b7b91';
  const GRID_LINE = '#141b25';

  const TFS = [['1m', '1分'], ['5m', '5分'], ['15m', '15分'], ['30m', '30分'],
               ['60m', '1时'], ['2h', '2时'], ['4h', '4时'], ['1d', '日线'], ['1w', '周线']];
  const TF_NAME = Object.fromEntries(TFS);
  const LS_KEY = 'futures_pro_params_v1';

  const DEFAULTS = {
    mas: [
      { on: true, p: 5, t: 'SMA', c: '#e6c15a' },
      { on: true, p: 10, t: 'SMA', c: '#ff8f47' },
      { on: true, p: 20, t: 'SMA', c: '#4c8dff' },
      { on: true, p: 60, t: 'SMA', c: '#c77dff' },
    ],
    boll: { on: true, n: 20, k: 2 },
    macd: { fast: 12, slow: 26, sig: 9 },
    trix: { n: 12, m: 9 },
    div: { on: true, k: 3, gap: 5, max: 6 },
    markCount: 8,
    show: { vol: true, macd: true, trix: true, mark: true, ma: true, zero: true, dual: true },
  };

  let zoomRaf = null, rendering = false;

  const S = {
    code: 'RB0', tf: '1d', bars: [], meta: {}, quote: {},
    p: null, macd: null, trix: null, boll: null, crossMacd: [], crossTrix: [], crossZero: [], draw: null, drawKey: '',
    chart: null, loading: false, autoRef: false, timer: null, lastLoad: 0,
  };

  const $ = (s) => document.querySelector(s);
  const el = {
    sel: $('#symbolSelect'), code: $('#codeInput'), btnLoad: $('#btnLoad'),
    tfs: $('#tfs'), chart: $('#chart'), legend: $('#legend'),
    loading: $('#loading'), loadTxt: $('#loadTxt'), toast: $('#toast'),
    qName: $('#qName'), qCode: $('#qCode'), qLast: $('#qLast'), qChg: $('#qChg'),
    qOpen: $('#qOpen'), qHigh: $('#qHigh'), qLow: $('#qLow'),
    qVol: $('#qVol'), qOi: $('#qOi'), qTf: $('#qTf'),
    vdMain: $('#vdMain'), vdBar: $('#vdBar'), vdRows: $('#vdRows'), vdTime: $('#vdTime'),
    sigList: $('#sigList'), statBox: $('#statBox'), statRange: $('#statRange'),
    stText: $('#stText'), stRight: $('#stRight'),
    autoRef: $('#autoRef'),
  };

  /* ------------------------------------------------------------------ 工具 */
  function num(v, d) {
    if (v === null || v === undefined || !isFinite(v)) return '—';
    return Number(v).toFixed(d === undefined ? 2 : d);
  }
  function digits(v) {
    const a = Math.abs(v);
    if (a >= 1000) return 0;
    if (a >= 100) return 1;
    if (a >= 10) return 2;
    return 3;
  }
  function fmtPrice(v) { return num(v, digits(v)); }
  function niceMax(m) {
    if (!isFinite(m) || m <= 0) return 1;
    const e = Math.pow(10, Math.floor(Math.log10(m)));
    const f = m / e;
    const n = f <= 1 ? 1 : f <= 1.5 ? 1.5 : f <= 2 ? 2 : f <= 2.5 ? 2.5 :
      f <= 3 ? 3 : f <= 4 ? 4 : f <= 5 ? 5 : f <= 6 ? 6 : f <= 8 ? 8 : 10;
    return n * e;
  }
  function fmtInd(v, base) {
    if (v === null || v === undefined || !isFinite(v)) return '';
    const a = Math.abs(v);
    if (a === 0) return '0';
    if (a >= 1) return v.toFixed(base);
    if (a >= 0.1) return v.toFixed(base + 1);
    return v.toFixed(base + 2);
  }
  function fmtBig(v) {
    if (!isFinite(v)) return '—';
    const a = Math.abs(v);
    if (a >= 1e8) return (v / 1e8).toFixed(2) + '亿';
    if (a >= 1e4) return (v / 1e4).toFixed(2) + '万';
    return v.toFixed(0);
  }
  function cls(v) { return v > 0 ? 'up' : v < 0 ? 'down' : 'flat'; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

  function fmtLabel(t) {
    if (!t) return '';
    if (t.length <= 10) return t;
    return t.slice(5, 16);           // MM-DD HH:mm
  }
  function fmtFull(t) {
    if (!t) return '';
    return t.length <= 10 ? t : t;
  }

  function toast(msg, type) {
    el.toast.textContent = msg;
    el.toast.className = 'show' + (type === 'info' ? ' info' : '');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { el.toast.className = ''; }, 3600);
  }
  function status(text, kind) {
    el.stText.innerHTML = text;
    el.stText.className = kind || '';
  }

  /* ---------------------------------------------------------------- 指标计算 */
  function sma(arr, n) {
    const o = new Array(arr.length).fill(null);
    let sum = 0, cnt = 0;
    for (let i = 0; i < arr.length; i++) {
      const v = arr[i];
      if (v === null || v === undefined || !isFinite(v)) { o[i] = null; continue; }
      sum += v; cnt++;
      if (cnt > n) { sum -= arr[i - n]; cnt = n; }
      if (cnt === n) o[i] = sum / n;
    }
    return o;
  }
  function ema(arr, n) {
    const o = new Array(arr.length).fill(null);
    const k = 2 / (n + 1);
    let prev = null, seed = [], seedSum = 0;
    for (let i = 0; i < arr.length; i++) {
      const v = arr[i];
      if (v === null || v === undefined || !isFinite(v)) { o[i] = null; continue; }
      if (prev === null) {
        seed.push(v); seedSum += v;
        if (seed.length === n) { prev = seedSum / n; o[i] = prev; }
        else o[i] = v;
        continue;
      }
      prev = v * k + prev * (1 - k);
      o[i] = prev;
    }
    return o;
  }
  function calcMACD(closes, f, s, g) {
    const ef = ema(closes, f), es = ema(closes, s);
    const dif = closes.map((_, i) => (ef[i] == null || es[i] == null) ? null : ef[i] - es[i]);
    const dea = new Array(closes.length).fill(null);
    const k = 2 / (g + 1);
    let prev = null;
    for (let i = 0; i < dif.length; i++) {
      if (dif[i] == null) continue;
      if (prev === null) { prev = dif[i]; dea[i] = prev; }
      else { prev = dif[i] * k + prev * (1 - k); dea[i] = prev; }
    }
    const hist = dif.map((v, i) => (v == null || dea[i] == null) ? null : (v - dea[i]) * 2);
    return { dif, dea, hist };
  }
  function calcTRIX(closes, n, m) {
    const e1 = ema(closes, n), e2 = ema(e1, n), e3 = ema(e2, n);
    const trix = new Array(closes.length).fill(null);
    for (let i = 1; i < e3.length; i++) {
      const a = e3[i], b = e3[i - 1];
      if (a == null || b == null || b === 0) continue;
      trix[i] = (a - b) / b * 100;
    }
    return { trix, matrix: sma(trix, m) };
  }
  function calcBOLL(closes, n, k) {
    const mid = sma(closes, n);
    const up = new Array(closes.length).fill(null);
    const low = new Array(closes.length).fill(null);
    for (let i = 0; i < closes.length; i++) {
      if (mid[i] == null) continue;
      let s = 0;
      for (let j = i - n + 1; j <= i; j++) {
        const dv = closes[j] - mid[i];
        s += dv * dv;
      }
      const sd = Math.sqrt(s / n);
      up[i] = mid[i] + k * sd;
      low[i] = mid[i] - k * sd;
    }
    return { mid, up, low };
  }
  /** 把序列按 0 轴切成一侧，另一侧置 null（相邻点保留一点过渡，避免断口） */
  function splitByZero(vals, side) {
    const out = new Array(vals.length).fill(null);
    for (let i = 0; i < vals.length; i++) {
      const v = vals[i];
      if (v == null) continue;
      if (side > 0 ? v >= 0 : v <= 0) { out[i] = v; continue; }
      const pv = i > 0 ? vals[i - 1] : null;
      const nv = i < vals.length - 1 ? vals[i + 1] : null;
      if (side > 0 ? (pv > 0 || nv > 0) : (pv < 0 || nv < 0)) out[i] = v;
    }
    return out;
  }

  /** 数值穿越 0 轴：上穿=多，下穿=空 */
  function findZeroCross(values) {
    const out = [];
    for (let i = 1; i < values.length; i++) {
      const a = values[i - 1], b = values[i];
      if (a == null || b == null) continue;
      if (a <= 0 && b > 0) out.push({ i: i, type: 'long' });
      else if (a >= 0 && b < 0) out.push({ i: i, type: 'short' });
    }
    return out;
  }
  function findCross(fast, slow) {
    const out = [];
    for (let i = 1; i < fast.length; i++) {
      const a0 = fast[i - 1], b0 = slow[i - 1], a1 = fast[i], b1 = slow[i];
      if (a0 == null || b0 == null || a1 == null || b1 == null) continue;
      const d0 = a0 - b0, d1 = a1 - b1;
      if (d0 <= 0 && d1 > 0) out.push({ i, type: 'long' });
      else if (d0 >= 0 && d1 < 0) out.push({ i, type: 'short' });
    }
    return out;
  }

  /* ------------------------------------------------------------ 背离线算法 */
  /** 摆动极值：左右各 k 根之内的最高价 / 最低价，返回索引数组 */
  function pivots(bars, k, kind) {
    const out = [];
    for (let i = k; i < bars.length - k; i++) {
      const v = kind === 'high' ? bars[i].h : bars[i].l;
      let ok = true;
      for (let j = i - k; j <= i + k; j++) {
        if (j === i) continue;
        const w = kind === 'high' ? bars[j].h : bars[j].l;
        if (kind === 'high' ? w > v : w < v) { ok = false; break; }
      }
      if (ok) out.push(i);
    }
    return out;
  }

  /**
   * 背离线（价格与 MACD 快线 DIF 的高低点背离）
   *   顶背离 top ：后一个摆动高点价格更高，但该处 DIF 比上一个高点更低  → 上涨动能衰竭，做空机会
   *   底背离 bottom：后一个摆动低点价格更低，但该处 DIF 比上一个低点更高 → 下跌动能衰竭，做多机会
   * 只在相邻两个摆动极值之间比较，且两者至少相隔 gap 根 K 线，避免同一波段的毛刺。
   */
  function findDivergence(bars, dif, opt) {
    const out = [];
    if (!bars || bars.length < 20 || !dif || dif.length !== bars.length) return out;
    const o = opt || {};
    const k = Math.max(2, Math.min(20, o.k || 3));
    const gap = Math.max(k, Math.min(120, o.gap || 5));
    const maxN = Math.max(1, Math.min(30, o.max || 6));

    const scan = (kind, type) => {
      const pts = pivots(bars, k, kind);
      if (pts.length < 2) return;
      let prev = pts[0];
      for (let m = 1; m < pts.length; m++) {
        const i2 = pts[m];
        if (i2 - prev < gap) continue;     // 间隔太近，不构成两次独立的冲高/探底
        const i1 = prev;
        prev = i2;
        const p1 = kind === 'high' ? bars[i1].h : bars[i1].l;
        const p2 = kind === 'high' ? bars[i2].h : bars[i2].l;
        const d1 = dif[i1], d2 = dif[i2];
        if (d1 == null || d2 == null) continue;
        const eps = Math.abs(d1) * 0.06 + 0.01;   // DIF 必须明显反向，避免噪声
        const priceBreak = kind === 'high' ? p2 > p1 : p2 < p1;
        const difDiverge = kind === 'high' ? d2 < d1 - eps : d2 > d1 + eps;
        if (priceBreak && difDiverge) {
          out.push({ type, i1, i2, p1, p2, d1, d2 });
        }
      }
    };
    scan('high', 'top');
    scan('low', 'bottom');
    out.sort((a, b) => a.i2 - b.i2);
    return out.slice(-maxN);
  }

  /**
   * 背离连线（每个背离一段独立线段：顶背离红、底背离绿）
   * main 为 true 时画价格高低点，false 时画 DIF 高低点。
   * 用 null 分隔多段，connectNulls:false 保证各段互不相连。
   */
  function divSeries(xIdx, yIdx, main) {
    if (!S.div || !S.div.length || S.p.div.on === false) return [];
    const out = [];
    ['top', 'bottom'].forEach(type => {
      const arr = S.div.filter(d => d.type === type);
      if (!arr.length) return;
      const top = type === 'top';
      const col = top ? UP : DOWN;
      const data = [];
      arr.forEach((d, k) => {
        if (k) data.push(null);
        if (main) data.push([d.i1, d.p1], [d.i2, d.p2]);
        else data.push([d.i1, d.d1], [d.i2, d.d2]);
      });
      out.push({
        name: top ? '顶背离' : '底背离',
        type: 'line',
        xAxisIndex: xIdx, yAxisIndex: yIdx,
        data: data,
        symbol: 'none',
        showSymbol: false,
        connectNulls: false,
        lineStyle: {
          width: main ? 2.6 : 2.2, color: col, opacity: 1,
          shadowBlur: 10, shadowColor: col,
        },
        itemStyle: { color: col },
        label: { show: false },
        emphasis: { disabled: true },
        silent: true,
        animation: false,
        z: main ? 8 : 9,
      });
    });
    return out;
  }

  /** 背离端点：独立散点画白边圆点，保证在密集K线里也看得见 */
  function divDots(xIdx, yIdx, main) {
    if (!S.div || !S.div.length || S.p.div.on === false) return null;
    const data = [];
    S.div.forEach(d => {
      const top = d.type === 'top';
      const col = top ? UP : DOWN;
      const a = main ? [d.i1, d.p1] : [d.i1, d.d1];
      const b = main ? [d.i2, d.p2] : [d.i2, d.d2];
      [a, b].forEach(v => data.push({
        value: v,
        itemStyle: {
          color: col, borderColor: '#ffffff', borderWidth: 1.6,
          shadowBlur: 6, shadowColor: col,
        },
      }));
    });
    return {
      animation: false, silent: true,
      symbolSize: main ? 9 : 6.5,
      z: main ? 11 : 10,
      data,
    };
  }

  /** 主图上的“顶背离 / 底背离”文字标注（标在后一个极值处） */
  function divLabels() {
    if (!S.div || !S.div.length || S.p.div.on === false) return null;
    return {
      animation: false,
      silent: true,
      symbolSize: 2,
      itemStyle: { color: 'transparent', borderWidth: 0 },
      z: 10,
      data: S.div.map(d => {
        const top = d.type === 'top';
        return {
          value: [d.i2, d.p2],
          label: {
            show: true,
            position: top ? 'top' : 'bottom',
            distance: 9,
            formatter: top ? '顶背离' : '底背离',
            color: '#fff',
            backgroundColor: top ? UP : DOWN,
            padding: [2, 5],
            borderRadius: 3,
            fontSize: 10,
            fontWeight: 700,
            shadowBlur: 6,
            shadowColor: top ? 'rgba(246,70,93,.45)' : 'rgba(14,203,129,.45)',
          },
        };
      }),
    };
  }

  /* ---------------------------------------------------------------- 参数存取 */
  function loadParams() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return JSON.parse(JSON.stringify(DEFAULTS));
      const p = JSON.parse(raw);
      const d = JSON.parse(JSON.stringify(DEFAULTS));
      if (!Array.isArray(p.mas) || !p.mas.length) p.mas = d.mas;
      p.macd = Object.assign({}, d.macd, p.macd || {});
      p.trix = Object.assign({}, d.trix, p.trix || {});
      p.boll = Object.assign({}, d.boll, p.boll || {});
      p.div = Object.assign({}, d.div, p.div || {});
      p.show = Object.assign({}, d.show, p.show || {});
      p.markCount = p.markCount || d.markCount;
      return p;
    } catch (e) { return JSON.parse(JSON.stringify(DEFAULTS)); }
  }
  function saveParams() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(S.p)); } catch (e) { }
  }

  /* ---------------------------------------------------------------- 数据请求 */
  async function getJSON(url) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 20000);
    try {
      const r = await fetch(url, { signal: ctl.signal, cache: 'no-store' });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || '接口错误');
      return j;
    } finally { clearTimeout(t); }
  }

  async function loadCatalog() {
    try {
      const j = await getJSON('/api/catalog');
      const frag = document.createDocumentFragment();
      j.groups.forEach(g => {
        const og = document.createElement('optgroup');
        og.label = g.name;
        g.items.forEach(it => {
          const o = document.createElement('option');
          o.value = it.code;
          o.textContent = it.name + '  ' + it.code.replace(/0$/, '');
          og.appendChild(o);
        });
        frag.appendChild(og);
      });
      el.sel.appendChild(frag);
    } catch (e) { console.warn(e); }
  }

  async function load(force) {
    if (S.loading) { S.pending = true; return; }
    S.loading = true;
    const t0 = performance.now();
    el.loading.classList.add('show');
    el.loadTxt.textContent = '加载 ' + S.code + ' · ' + TF_NAME[S.tf] + ' …';
    try {
      const q = await getJSON('/api/kline?code=' + encodeURIComponent(S.code) +
        '&tf=' + S.tf + (force ? '&force=1' : ''));
      S.bars = q.bars || [];
      S.meta = q.meta || {};
      if (!S.bars.length) throw new Error('该周期暂无数据');

      computeAll();
      renderChart();
      syncDraw();
      renderSide();
      renderLegend();

      try {
        const qq = await getJSON('/api/quote?code=' + encodeURIComponent(S.code));
        S.quote = qq.quote || {};
        renderQuote();
      } catch (e) { renderQuote(true); }

      const ms = Math.round(performance.now() - t0);
      S.lastLoad = Date.now();
      const src = S.meta.source || '';
      status('<span class="ok">●</span> ' + esc(S.meta.name || S.code) + ' · ' + TF_NAME[S.tf] +
        ' · ' + S.bars.length + ' 根K线 · ' + esc(src) + ' · ' + esc(S.meta.updated || '') +
        (S.meta.notice ? ' · <span class="warn">' + esc(S.meta.notice) + '</span>' : ''),
        '');
      el.stRight.textContent = ms + ' ms   ' + new Date().toLocaleTimeString('zh-CN');
      if (S.meta.notice) toast(S.meta.notice, 'info');
    } catch (e) {
      status('<span class="err">●</span> 加载失败：' + esc(e.message), '');
      toast('加载失败：' + e.message);
    } finally {
      S.loading = false;
      el.loading.classList.remove('show');
      if (S.pending) {
        S.pending = false;
        setTimeout(() => load(), 60);
      }
    }
  }

  function computeAll() {
    const p = S.p;
    const closes = S.bars.map(b => b.c);
    S.closes = closes;
    S.vols = S.bars.map(b => b.v);
    S.maCache = {};
    p.mas.forEach(m => {
      if (!m.on) return;
      S.maCache[m.p + m.t] = (m.t === 'EMA') ? ema(closes, m.p) : sma(closes, m.p);
    });
    S.boll = calcBOLL(closes, p.boll.n, p.boll.k);
    S.macd = calcMACD(closes, p.macd.fast, p.macd.slow, p.macd.sig);
    S.trix = calcTRIX(closes, p.trix.n, p.trix.m);
    S.crossMacd = findCross(S.macd.dif, S.macd.dea);
    S.crossZero = findZeroCross(S.macd.dif);
    S.crossTrix = findCross(S.trix.trix, S.trix.matrix);
    S.div = findDivergence(S.bars, S.macd.dif, p.div || DEFAULTS.div);
  }

  /* ---------------------------------------------------------------- 报价条 */
  function renderQuote(failed) {
    const q = S.quote || {};
    const last = q.last || (S.bars.length ? S.bars[S.bars.length - 1].c : null);
    const prev = q.prev || 0;
    const chg = (prev > 0 && last) ? last - prev : (q.change || 0);
    const pct = (prev > 0 && last) ? (last - prev) / prev * 100 : (q.pct || 0);

    el.qName.textContent = (q.name || S.meta.name || S.code).replace(/连续$/, '');
    el.qCode.textContent = S.code;
    el.qLast.textContent = last ? fmtPrice(last) : '—';
    el.qLast.className = cls(chg);
    el.qChg.textContent = failed ? '—' : (chg >= 0 ? '+' : '') + fmtPrice(chg) + '  ' +
      (pct >= 0 ? '+' : '') + num(pct, 2) + '%';
    el.qChg.className = 'chg ' + cls(chg);
    el.qOpen.textContent = q.open ? fmtPrice(q.open) : '—';
    el.qHigh.textContent = q.high ? fmtPrice(q.high) : '—';
    el.qLow.textContent = q.low ? fmtPrice(q.low) : '—';
    el.qVol.textContent = q.volume ? fmtBig(q.volume) : '—';
    el.qOi.textContent = q.oi ? fmtBig(q.oi) : '—';
    el.qTf.textContent = TF_NAME[S.tf];
  }

  /* ---------------------------------------------------------------- 图例 */
  function renderLegend() {
    const p = S.p;
    const items = [];
    if (p.show.ma !== false) p.mas.forEach(m => {
      if (!m.on) return;
      items.push('<span class="pill"><i class="dot" style="background:' + m.c + '"></i>MA' +
        m.p + (m.t === 'EMA' ? 'E' : '') + '</span>');
    });
    if (p.boll.on) {
      items.push('<span class="pill">' +
        '<i class="dot" style="background:' + UP + '"></i>' +
        '<i class="dot" style="background:' + GOLD + ';opacity:.85"></i>' +
        '<i class="dot" style="background:' + DOWN + '"></i>BOLL(' +
        p.boll.n + ',' + p.boll.k + ')</span>');
    }
    if (p.div.on !== false && S.div && S.div.length) {
      items.push('<span class="pill"><i class="dot" style="background:' + UP + '"></i>' +
        '<i class="dot" style="background:' + DOWN + '"></i>背离 ' + S.div.length + '</span>');
    }
    items.push('<i class="sep"></i>');
    items.push('<span class="pill">MACD(' + p.macd.fast + ',' + p.macd.slow + ',' + p.macd.sig + ')</span>');
    items.push('<span class="pill">TRIX(' + p.trix.n + ',' + p.trix.m + ')</span>');
    el.legend.innerHTML = items.join('');
  }

  /* ---------------------------------------------------------------- 主图 */
  function buildOption() {
    const p = S.p, bars = S.bars, n = bars.length;
    const cats = bars.map(b => b.t);
    const labels = bars.map(b => fmtLabel(b.t));
    const closes = S.closes;
    const ohlc = bars.map(b => [b.o, b.c, b.l, b.h]);

    const panels = [{ key: 'main', w: 52 }];
    if (p.show.vol) panels.push({ key: 'vol', w: 11 });
    if (p.show.macd) panels.push({ key: 'macd', w: 17 });
    if (p.show.trix) panels.push({ key: 'trix', w: 17 });

    const H = Math.max(420, el.chart.clientHeight || 600);
    const topPx = 40, botPx = 58, gapPx = 18;
    const avail = H - topPx - botPx - gapPx * (panels.length - 1);
    const sumW = panels.reduce((a, b) => a + b.w, 0);
    const grids = [], axisIdx = {};
    let y = topPx;
    panels.forEach((pn, k) => {
      const h = avail * pn.w / sumW;
      grids.push({
        left: 14, right: 74, top: y, height: h,
        containLabel: false,
      });
      axisIdx[pn.key] = k;
      y += h + gapPx;
    });
    // 百分比化，窗口缩放时自动跟随
    grids.forEach(g => {
      g.top = (g.top / H * 100).toFixed(3) + '%';
      g.height = (g.height / H * 100).toFixed(3) + '%';
    });

    const digitsMain = digits(closes[n - 1]);
    const yAxisCommon = {
      scale: true, position: 'right', splitNumber: 5,
      axisLine: { show: false }, axisTick: { show: false },
      splitLine: { show: true, lineStyle: { color: GRID_LINE, type: 'solid' } },
      axisLabel: { color: MUTED, fontSize: 10.5, margin: 8 },
    };

    const xAxis = grids.map((g, i) => ({
      type: 'category', data: labels, gridIndex: i,
      boundaryGap: true,
      axisLine: { lineStyle: { color: '#1b2432' } },
      axisTick: { show: false },
      splitLine: { show: false },
      axisLabel: i === grids.length - 1
        ? { color: MUTED, fontSize: 10.5, hideOverlap: true, margin: 8 }
        : { show: false },
      axisPointer: { label: { show: i === grids.length - 1 } },
    }));

    const yAxis = [];
    // 主图
    yAxis.push(Object.assign({}, yAxisCommon, {
      gridIndex: 0,
      axisLabel: {
        color: MUTED, fontSize: 10.5, margin: 8,
        formatter: v => num(v, digitsMain),
      },
    }));
    let ptr = 1;
    if (p.show.vol) {
      yAxis.push({
        gridIndex: axisIdx.vol,
        scale: false, position: 'right', splitNumber: 2,
        axisLine: { show: false }, axisTick: { show: false },
        splitLine: { show: false },
        axisLabel: { color: MUTED, fontSize: 10, formatter: v => fmtBig(v) },
        max: v => niceMax((v.max || 1) * 1.12),
      });
      ptr = axisIdx.vol;
    }
    if (p.show.macd) {
      yAxis.push({
        gridIndex: axisIdx.macd,
        scale: true, position: 'right', splitNumber: 2,
        axisLine: { show: false }, axisTick: { show: false },
        splitLine: { show: true, lineStyle: { color: GRID_LINE } },
        axisLabel: { color: MUTED, fontSize: 10, formatter: v => fmtInd(v, 1) },
      });
    }
    if (p.show.trix) {
      yAxis.push({
        gridIndex: axisIdx.trix,
        scale: true, position: 'right', splitNumber: 2,
        axisLine: { show: false }, axisTick: { show: false },
        splitLine: { show: true, lineStyle: { color: GRID_LINE } },
        axisLabel: { color: MUTED, fontSize: 10, formatter: v => fmtInd(v, 2) },
      });
    }

    /* ---- series ---- */
    const series = [];
    const mainMark = p.show.mark ? trixMark('main') : null;
    const divMain = divSeries(0, 0, true);
    const divMacd = p.show.macd ? divSeries(axisIdx.macd, axisIdx.macd, false) : [];
    const divMainDots = divDots(0, 0, true);
    const divMacdDots = p.show.macd ? divDots(axisIdx.macd, axisIdx.macd, false) : null;
    const divTip = divLabels();

    series.push({
      name: 'K线', type: 'candlestick', data: ohlc,
      xAxisIndex: 0, yAxisIndex: 0,
      barMaxWidth: 13,
      itemStyle: {
        color: UP, color0: DOWN, borderColor: UP, borderColor0: DOWN,
        borderWidth: 1,
      },
      markPoint: mainMark || undefined,
      markLine: {
        silent: true, symbol: 'none', animation: false,
        lineStyle: { color: 'rgba(224,177,85,.55)', width: 1, type: 'dashed' },
        label: { show: false },
        data: [{ yAxis: closes[n - 1] }],
      },
      z: 5,
    });

    if (p.boll.on && S.boll) {
      const b = S.boll;
      const band = b.up.map((v, i) => (v == null || b.low[i] == null) ? null : v - b.low[i]);
      series.push({
        name: 'BOLL下轨', type: 'line', xAxisIndex: 0, yAxisIndex: 0,
        data: b.low, symbol: 'none', stack: 'bollBand', silent: true,
        lineStyle: { width: 1.2, color: DOWN, opacity: .88, type: 'dashed' },
        areaStyle: { color: 'transparent' },
        emphasis: { disabled: true }, animation: false, z: 3,
      });
      series.push({
        name: 'BOLL上轨', type: 'line', xAxisIndex: 0, yAxisIndex: 0,
        data: band, symbol: 'none', stack: 'bollBand', silent: true,
        lineStyle: { width: 1.2, color: UP, opacity: .88, type: 'dashed' },
        areaStyle: { color: 'rgba(150,166,190,.05)' },
        emphasis: { disabled: true }, animation: false, z: 3,
      });
      series.push({
        name: 'BOLL中轨', type: 'line', xAxisIndex: 0, yAxisIndex: 0,
        data: b.mid, symbol: 'none', silent: true,
        lineStyle: { width: 1.1, color: 'rgba(224,177,85,.75)' },
        emphasis: { disabled: true }, animation: false, z: 3,
      });
    }

    if (p.show.ma) p.mas.forEach(m => {
      if (!m.on) return;
      series.push({
        name: 'MA' + m.p, type: 'line',
        xAxisIndex: 0, yAxisIndex: 0,
        data: S.maCache[m.p + m.t],
        symbol: 'none', smooth: false, connectNulls: false,
        lineStyle: { width: 1.2, color: m.c },
        emphasis: { disabled: true },
        z: 6,
        animation: false,
      });
    });

    if (p.show.vol) {
      const vi = axisIdx.vol;
      series.push({
        name: '成交量', type: 'bar', xAxisIndex: vi, yAxisIndex: vi,
        data: bars.map(b => ({
          value: b.v,
          itemStyle: { color: b.c >= b.o ? 'rgba(246,70,93,.62)' : 'rgba(14,203,129,.62)' },
        })),
        barMaxWidth: 13,
      });
      const v5 = sma(S.vols, 5), v10 = sma(S.vols, 10);
      series.push({
        name: 'VOL MA5', type: 'line', xAxisIndex: vi, yAxisIndex: vi, data: v5,
        symbol: 'none', lineStyle: { width: 1, color: 'rgba(230,193,90,.75)' },
        emphasis: { disabled: true },
      });
      series.push({
        name: 'VOL MA10', type: 'line', xAxisIndex: vi, yAxisIndex: vi, data: v10,
        symbol: 'none', lineStyle: { width: 1, color: 'rgba(76,141,255,.65)' },
        emphasis: { disabled: true },
      });
    }

    if (p.show.macd) {
      const mi = axisIdx.macd;
      const idxHist = series.length;
      series.push({
        name: 'MACD柱', type: 'bar', xAxisIndex: mi, yAxisIndex: mi,
        data: S.macd.hist.map(v => ({
          value: v,
          itemStyle: { color: v >= 0 ? UP : DOWN },
        })),
        barMaxWidth: 5,
        markPoint: (p.show.mark && p.show.zero !== false) ? zeroMark() : undefined,
        markLine: {
          silent: true, symbol: 'none', animation: false,
          lineStyle: { color: '#33445c', width: 1 },
          data: [{ yAxis: 0 }],
          label: { show: false },
        },
        z: 4,
      });
      const mp = p.show.mark ? crossMark(S.crossMacd, S.macd.dif, 'macd') : undefined;
      if (p.show.dual === false) {
        series.push({
          name: 'DIF', type: 'line', xAxisIndex: mi, yAxisIndex: mi, data: S.macd.dif,
          symbol: 'none', lineStyle: { width: 1.35, color: '#f0b90b' },
          emphasis: { disabled: true }, z: 6, markPoint: mp,
        });
        series.push({
          name: 'DEA', type: 'line', xAxisIndex: mi, yAxisIndex: mi, data: S.macd.dea,
          symbol: 'none', lineStyle: { width: 1.15, color: '#4c8dff', type: 'dashed' },
          emphasis: { disabled: true }, z: 5,
        });
      } else {
        // 0 轴之上红（多）、之下绿（空）：按 0 轴切段绘制
        series.push({
          name: 'DIF', type: 'line', xAxisIndex: mi, yAxisIndex: mi,
          data: splitByZero(S.macd.dif, 1),
          symbol: 'none', connectNulls: false,
          lineStyle: { width: 1.35, color: UP },
          emphasis: { disabled: true }, z: 6, markPoint: mp,
        });
        series.push({
          name: 'DIF', type: 'line', xAxisIndex: mi, yAxisIndex: mi,
          data: splitByZero(S.macd.dif, -1),
          symbol: 'none', connectNulls: false,
          lineStyle: { width: 1.35, color: DOWN },
          emphasis: { disabled: true }, z: 6,
        });
        series.push({
          name: 'DEA', type: 'line', xAxisIndex: mi, yAxisIndex: mi,
          data: splitByZero(S.macd.dea, 1),
          symbol: 'none', connectNulls: false,
          lineStyle: { width: 1.15, color: 'rgba(246,70,93,.66)', type: 'dashed' },
          emphasis: { disabled: true }, z: 5,
        });
        series.push({
          name: 'DEA', type: 'line', xAxisIndex: mi, yAxisIndex: mi,
          data: splitByZero(S.macd.dea, -1),
          symbol: 'none', connectNulls: false,
          lineStyle: { width: 1.15, color: 'rgba(14,203,129,.7)', type: 'dashed' },
          emphasis: { disabled: true }, z: 5,
        });
      }
    }

    if (p.show.trix) {
      const ti = axisIdx.trix;
      series.push({
        name: 'TRIX', type: 'line', xAxisIndex: ti, yAxisIndex: ti, data: S.trix.trix,
        symbol: 'none', lineStyle: { width: 1.2, color: '#c77dff' },
        emphasis: { disabled: true },
        markLine: {
          silent: true, symbol: 'none', animation: false,
          lineStyle: { color: '#25313f', width: 1 },
          data: [{ yAxis: 0 }],
          label: { show: false },
        },
        markPoint: crossMark(S.crossTrix, S.trix.trix, 'trix'),
      });
      series.push({
        name: 'MATRIX', type: 'line', xAxisIndex: ti, yAxisIndex: ti, data: S.trix.matrix,
        symbol: 'none', lineStyle: { width: 1.2, color: '#ffb44d' },
        emphasis: { disabled: true },
      });
    }

    /* ---- 背离线：主图价格连线 + MACD 副图 DIF 连线 + 文字标注 ---- */
    divMain.forEach(s => series.push(s));
    divMacd.forEach(s => series.push(s));
    if (divMainDots) {
      series.push(Object.assign({
        name: '背离端点', type: 'scatter', xAxisIndex: 0, yAxisIndex: 0,
      }, divMainDots));
    }
    if (divMacdDots) {
      series.push(Object.assign({
        name: '背离端点', type: 'scatter',
        xAxisIndex: axisIdx.macd, yAxisIndex: axisIdx.macd,
      }, divMacdDots));
    }
    if (divTip) {
      series.push(Object.assign({
        name: '背离标注', type: 'scatter', xAxisIndex: 0, yAxisIndex: 0,
      }, divTip));
    }

    /* ---- zoom ---- */
    const visible = S.tf === '1d' || S.tf === '1w' ? 200 : 220;
    let start = 0, end = 100;
    if (n > visible) start = (1 - visible / n) * 100;
    if (S.zoom && S.zoom.n === n && S.zoom.tf === S.tf) { start = S.zoom.start; end = S.zoom.end; }
    S.zoomNow = { start: start, end: end };

    const dz = [
      {
        type: 'inside', xAxisIndex: xAxis.map((_, i) => i),
        start: start, end: end, minValueSpan: 12,
        zoomOnMouseWheel: true, moveOnMouseMove: true, moveOnMouseWheel: false,
      },
      {
        type: 'slider', xAxisIndex: xAxis.map((_, i) => i),
        start: start, end: end, bottom: 10, height: 16,
        borderColor: 'transparent',
        backgroundColor: '#0c1119',
        fillerColor: 'rgba(76,141,255,.12)',
        dataBackground: {
          lineStyle: { color: '#25313f' }, areaStyle: { color: '#151d28' },
        },
        selectedDataBackground: {
          lineStyle: { color: 'rgba(76,141,255,.55)' },
          areaStyle: { color: 'rgba(76,141,255,.12)' },
        },
        handleStyle: { color: '#2a3a52', borderColor: '#3b5170' },
        moveHandleStyle: { color: '#1e2a3a' },
        textStyle: { color: MUTED, fontSize: 10 },
        brushSelect: false,
      },
    ];

    const titles = [];
    const gridTop = grids.map(g => parseFloat(g.top));
    if (p.show.vol) titles.push(panelTitle('成交量 VOL', gridTop[axisIdx.vol]));
    if (p.show.macd) titles.push(panelTitle(
      'MACD (' + p.macd.fast + ',' + p.macd.slow + ',' + p.macd.sig + ')  0轴上→多 / 0轴下→空',
      gridTop[axisIdx.macd], zeroState(closes.length - 1)));
    if (p.show.trix) titles.push(panelTitle('TRIX (' + p.trix.n + ',' + p.trix.m + ')  金叉→多 / 死叉→空', gridTop[axisIdx.trix]));

    return {
      animation: false,
      backgroundColor: 'transparent',
      textStyle: { fontFamily: '"Microsoft YaHei UI", "Microsoft YaHei", sans-serif' },
      title: titles,
      grid: grids,
      xAxis: xAxis,
      yAxis: yAxis,
      series: series,
      axisPointer: {
        link: [{ xAxisIndex: 'all' }],
        label: { backgroundColor: '#1e2937', borderColor: '#30405a', borderWidth: 1, color: '#dce5f2', fontSize: 10.5 },
      },
      dataZoom: dz,
      tooltip: {
        trigger: 'axis',
        confine: true,
        backgroundColor: 'rgba(13,18,26,.96)',
        borderColor: '#243040',
        borderWidth: 1,
        padding: [9, 12],
        textStyle: { color: '#dce5f2', fontSize: 12 },
        extraCssText: 'box-shadow:0 10px 30px rgba(0,0,0,.55);border-radius:8px;',
        axisPointer: {
          type: 'cross',
          crossStyle: { color: '#3a4a63', width: 1, type: 'dashed' },
          lineStyle: { color: '#3a4a63', width: 1, type: 'dashed' },
        },
        formatter: tooltipFormatter,
      },
    };
  }

  function panelTitle(text, topPct, badge) {
    const style = { color: MUTED, fontSize: 11, fontWeight: 400 };
    let t = text;
    if (badge) {
      t = text + '  {b|' + badge.txt + '}';
      style.rich = {
        b: {
          color: badge.color, fontSize: 10, fontWeight: 700,
          backgroundColor: badge.bg, padding: [3, 7],
          borderRadius: 3, borderWidth: 1, borderColor: badge.color,
        },
      };
    }
    return { text: t, left: 16, top: (topPct - 3.2) + '%', textStyle: style };
  }

  /** MACD 零轴多空状态 */
  function zeroState(i) {
    const v = (S.macd && S.macd.dif) ? S.macd.dif[i] : null;
    if (v == null) return null;
    return v >= 0
      ? { txt: '0轴上方 · 多头', color: UP, bg: 'rgba(246,70,93,.13)', dir: 1 }
      : { txt: '0轴下方 · 空头', color: DOWN, bg: 'rgba(14,203,129,.13)', dir: -1 };
  }

  function crossMark(crosses, values, key) {
    if (!crosses || !crosses.length) return undefined;
    const p = S.p;
    const cnt = Math.min(p.markCount || 8, crosses.length);
    const items = crosses.slice(-cnt).map(c => {
      const v = values[c.i];
      if (v == null) return null;
      const long = c.type === 'long';
      return {
        coord: [fmtLabel(S.bars[c.i].t), v],
        value: long ? '多' : '空',
        symbol: 'circle',
        symbolSize: 4,
        itemStyle: {
          color: long ? UP : DOWN,
          borderColor: long ? UP : DOWN,
        },
        label: {
          show: true,
          position: long ? 'bottom' : 'top',
          distance: 6,
          formatter: long ? '多' : '空',
          color: '#fff',
          backgroundColor: long ? UP : DOWN,
          padding: [2, 5],
          borderRadius: 3,
          fontSize: 10,
          fontWeight: 700,
          shadowBlur: 6,
          shadowColor: long ? 'rgba(246,70,93,.5)' : 'rgba(14,203,129,.5)',
        },
      };
    }).filter(Boolean);
    const first = items[0];
    return {
      animation: false,
      silent: true,
      symbol: 'circle',
      symbolSize: 4,
      itemStyle: first ? first.itemStyle : {},
      data: items,
      z: 9,
    };
  }

  /** MACD 穿越 0 轴的多空标记（小方块，与金叉/死叉标签区分） */
  function zeroMark() {
    const crosses = S.crossZero || [];
    if (!crosses.length) return undefined;
    const cnt = Math.min(S.p.markCount || 8, crosses.length);
    const items = crosses.slice(-cnt).map(c => {
      const bar = S.bars[c.i];
      if (!bar) return null;
      const long = c.type === 'long';
      const col = long ? UP : DOWN;
      return {
        coord: [fmtLabel(bar.t), 0],
        value: long ? '多' : '空',
        symbol: 'roundRect',
        symbolSize: [18, 11],
        symbolOffset: [0, long ? -9 : 9],
        itemStyle: {
          color: long ? 'rgba(246,70,93,.16)' : 'rgba(14,203,129,.16)',
          borderColor: col, borderWidth: 1,
        },
        label: {
          show: true, position: 'inside',
          formatter: long ? '多' : '空',
          color: col, fontSize: 8.5, fontWeight: 700,
        },
      };
    }).filter(Boolean);
    if (!items.length) return undefined;
    return { animation: false, silent: true, data: items, z: 12 };
  }

  function trixMark(target) {
    const crosses = S.crossTrix;
    if (!crosses.length) return undefined;
    const cnt = Math.min(S.p.markCount || 8, crosses.length);
    const items = crosses.slice(-cnt).map(c => {
      const bar = S.bars[c.i];
      if (!bar) return null;
      const long = c.type === 'long';
      return {
        coord: [fmtLabel(bar.t), long ? bar.l : bar.h],
        value: long ? '多' : '空',
        symbol: 'circle',
        symbolSize: 3,
        itemStyle: { color: long ? UP : DOWN },
        label: {
          show: true,
          position: long ? 'bottom' : 'top',
          distance: 5,
          formatter: long ? '多' : '空',
          color: '#fff',
          backgroundColor: long ? UP : DOWN,
          padding: [2, 5],
          borderRadius: 3,
          fontSize: 10,
          fontWeight: 700,
        },
      };
    }).filter(Boolean);
    return { animation: false, silent: true, data: items, z: 9 };
  }

  /* ---------------------------------------------------------------- 提示框 */
  function tooltipFormatter(params) {
    if (!params || !params.length) return '';
    const i = params[0].dataIndex;
    const b = S.bars[i];
    if (!b) return '';
    const prev = i > 0 ? S.bars[i - 1].c : b.o;
    const chg = b.c - prev;
    const pct = prev ? chg / prev * 100 : 0;
    const d = digits(b.c);
    const color = chg >= 0 ? UP : DOWN;
    const rows = [];
    const row = (k, v, c) => '<div class="tp-r"><span>' + k + '</span><b' +
      (c ? ' style="color:' + c + '"' : '') + '>' + v + '</b></div>';

    rows.push('<div class="tp-h">' + esc(fmtFull(b.t)) + '<em>' + TF_NAME[S.tf] + '</em></div>');
    rows.push(row('开', num(b.o, d)));
    rows.push(row('高', num(b.h, d)));
    rows.push(row('低', num(b.l, d)));
    rows.push(row('收', num(b.c, d), color));
    rows.push(row('涨跌', (chg >= 0 ? '+' : '') + num(chg, d) + ' (' +
      (pct >= 0 ? '+' : '') + num(pct, 2) + '%)', color));
    rows.push(row('成交量', fmtBig(b.v)));
    if (b.oi) rows.push(row('持仓量', fmtBig(b.oi)));

    const ma = [];
    S.p.mas.forEach(m => {
      if (!m.on) return;
      const arr = S.maCache[m.p + m.t];
      if (arr && arr[i] != null) {
        ma.push('<span style="color:' + m.c + '">MA' + m.p + ' ' + num(arr[i], d) + '</span>');
      }
    });
    if (ma.length) rows.push('<div class="tp-ma">' + ma.join('') + '</div>');

    if (S.p.boll.on && S.boll) {
      const bu = S.boll.up[i], bm = S.boll.mid[i], bl = S.boll.low[i];
      if (bu != null) {
        rows.push('<div class="tp-sep">BOLL(' + S.p.boll.n + ',' + S.p.boll.k + ')</div>');
        rows.push('<div class="tp-3">' +
          '<span style="color:' + UP + '">上轨 ' + num(bu, d) + '</span>' +
          '<span style="color:#e0b155">中轨 ' + num(bm, d) + '</span>' +
          '<span style="color:' + DOWN + '">下轨 ' + num(bl, d) + '</span>' +
          '</div>');
      }
    }

    if (S.p.show.macd) {
      const v1 = S.macd.dif[i], v2 = S.macd.dea[i], v3 = S.macd.hist[i];
      rows.push('<div class="tp-sep">MACD</div>');
      rows.push('<div class="tp-3">' +
        '<span style="color:' + (v1 >= 0 ? UP : DOWN) + '">DIF ' + num(v1, 2) + '</span>' +
        '<span style="color:' + (v2 >= 0 ? 'rgba(246,70,93,.7)' : 'rgba(14,203,129,.72)') + '">DEA ' + num(v2, 2) + '</span>' +
        '<span style="color:' + (v3 >= 0 ? UP : DOWN) + '">MACD ' + num(v3, 2) + '</span>' +
        '</div>');
      if (v1 != null) {
        rows.push('<div class="tp-r"><span>零轴</span><b style="color:' +
          (v1 >= 0 ? UP : DOWN) + '">' + (v1 >= 0 ? '0轴上方 · 看多' : '0轴下方 · 看空') + '</b></div>');
      }
    }
    if (S.p.show.trix) {
      const t1 = S.trix.trix[i], t2 = S.trix.matrix[i];
      rows.push('<div class="tp-sep">TRIX</div>');
      rows.push('<div class="tp-3">' +
        '<span style="color:#c77dff">TRIX ' + num(t1, 3) + '</span>' +
        '<span style="color:#ffb44d">MA ' + num(t2, 3) + '</span>' +
        '<span style="color:' + (t1 != null && t2 != null && t1 >= t2 ? UP : DOWN) + '">' +
        (t1 != null && t2 != null && t1 >= t2 ? '多头' : '空头') + '</span>' +
        '</div>');
    }
    return '<div class="tp">' + rows.join('') + '</div>';
  }

  /* ---------------------------------------------------------------- 画线图层 */
  function initDraw() {
    if (S.draw || typeof createDrawLayer !== 'function') return;
    S.draw = createDrawLayer({
      host: el.chart,
      canvas: $('#drawCanvas'),
      getChart: () => S.chart,
      getBars: () => S.bars,
      onHint: txt => { const h = $('#drawHint'); if (h) h.textContent = txt || ''; },
      onLockPan: on => {
        if (!S.chart) return;
        try { S.chart.setOption({ dataZoom: [{ moveOnMouseMove: !on }] }); } catch (e) { }
      },
    });
  }

  function syncDraw() {
    initDraw();
    if (!S.draw) return;
    const key = S.code + '|' + S.tf;
    if (S.drawKey !== key) {
      S.drawKey = key;
      S.draw.setContext(S.code, S.tf);
    } else {
      S.draw.redraw();
    }
  }

  /* ---------------------------------------------------------------- 渲染图 */
  function renderChart() {
    if (!S.chart) {
      S.chart = echarts.init(el.chart, null, { renderer: 'canvas' });
      S.chart.on('datazoom', function () {
        const dz = S.chart.getOption().dataZoom[0];
        S.zoom = { n: S.bars.length, tf: S.tf, start: dz.start, end: dz.end };
        if (S.draw) S.draw.redraw();
        if (rendering) return;
        if (zoomRaf) cancelAnimationFrame(zoomRaf);
        zoomRaf = requestAnimationFrame(() => { zoomRaf = null; renderStats(); });
      });
      S.chart.on('rendered', function () { if (S.draw) S.draw.redraw(); });
    }
    const opt = buildOption();
    S.chart.setOption(opt, { notMerge: true, lazyUpdate: false });
    if (S.zoomNow) S.zoom = { n: S.bars.length, tf: S.tf, start: S.zoomNow.start, end: S.zoomNow.end };
    if (S.draw) S.draw.redraw();
  }

  /* ---------------------------------------------------------------- 侧栏 */
  function judge() {
    const closes = S.closes, i = closes.length - 1;
    const p = S.p;
    const periods = p.mas.filter(m => m.on).map(m => m.p).sort((a, b) => a - b).slice(0, 3);
    [5, 10, 20, 60].forEach(f => {
      if (periods.length < 3 && periods.indexOf(f) < 0) periods.push(f);
    });
    periods.sort((a, b) => a - b);

    const mas = periods.map(n => sma(closes, n)[i]);
    const ma20 = sma(closes, 20)[i] != null ? sma(closes, 20)[i] : sma(closes, Math.min(20, closes.length))[i];
    const dif = S.macd.dif[i], dea = S.macd.dea[i], hist = S.macd.hist[i];
    const t1 = S.trix.trix[i], t2 = S.trix.matrix[i];

    let score = 0;
    const rows = [];

    // 均线排列
    let maState = 0;
    if (mas.every(v => v != null)) {
      if (mas[0] > mas[1] && mas[1] > mas[2]) maState = 1;
      else if (mas[0] < mas[1] && mas[1] < mas[2]) maState = -1;
    }
    score += maState;
    rows.push({
      k: '均线排列',
      tag: maState > 0 ? '多' : maState < 0 ? '空' : '中性',
      v: mas.every(v => v != null)
        ? 'MA' + periods.join('/') + (maState > 0 ? ' 多头排列' : maState < 0 ? ' 空头排列' : ' 交织')
        : '—',
    });

    // 价格位置
    const above = ma20 != null && closes[i] > ma20;
    score += above ? 1 : (ma20 != null ? -1 : 0);
    rows.push({
      k: '价格位置',
      tag: above ? '多' : '空',
      v: ma20 != null ? (above ? '站上' : '跌破') + ' MA20' : '—',
    });

    // MACD 交叉
    let macdState = 0;
    if (dif != null && dea != null) macdState = dif > dea ? 1 : -1;
    score += macdState;
    rows.push({
      k: 'MACD 交叉',
      tag: macdState > 0 ? '多' : macdState < 0 ? '空' : '中性',
      v: dif == null ? '—' : (macdState > 0 ? '金叉 · DIF>DEA' : '死叉 · DIF<DEA') + ' · ' + num(hist, 2),
    });

    // MACD 零轴
    const zeroDir = dif == null ? 0 : (dif >= 0 ? 1 : -1);
    score += zeroDir;
    rows.push({
      k: 'MACD 零轴',
      tag: zeroDir > 0 ? '多' : zeroDir < 0 ? '空' : '中性',
      v: dif == null ? '—' : 'DIF ' + num(dif, 2) + ' · 0轴' + (zeroDir > 0 ? '上方' : '下方'),
    });

    // TRIX
    let trixState = 0;
    if (t1 != null && t2 != null) trixState = t1 > t2 ? 1 : -1;
    score += trixState;
    rows.push({
      k: 'TRIX',
      tag: trixState > 0 ? '多' : trixState < 0 ? '空' : '中性',
      v: t1 == null ? '—' : (trixState > 0 ? 'TRIX在信号线上' : 'TRIX在信号线下') + ' · ' + num(t1, 2),
    });

    // 布林带
    let bollState = 0, bollTxt = '—';
    if (S.boll && S.boll.mid[i] != null) {
      const bu = S.boll.up[i], bm = S.boll.mid[i], bl = S.boll.low[i];
      const c0 = closes[i];
      bollState = c0 >= bm ? 1 : -1;
      if (bu != null && c0 > bu) bollTxt = '突破上轨 强势';
      else if (bl != null && c0 < bl) bollTxt = '跌破下轨 弱势';
      else bollTxt = c0 >= bm ? '中轨上方' : '中轨下方';
      bollTxt += ' · ' + num(bm, digits(c0));
    }
    score += bollState;
    rows.push({
      k: '布林带',
      tag: bollState > 0 ? '多' : bollState < 0 ? '空' : '中性',
      v: bollTxt,
    });

    // 最近信号
    const lastSig = lastSignal();
    rows.push({
      k: '最新信号',
      tag: lastSig ? (lastSig.type === 'long' ? '多' : '空') : '中性',
      v: lastSig ? lastSig.src + ' · ' + fmtLabel(S.bars[lastSig.i].t) : '暂无',
    });

    return { score, rows, lastSig, maxScore: 6 };
  }

  function lastSignal() {
    const arr = [];
    if (S.crossMacd.length) arr.push(Object.assign({ src: 'MACD' }, S.crossMacd[S.crossMacd.length - 1]));
    if (S.crossTrix.length) arr.push(Object.assign({ src: 'TRIX' }, S.crossTrix[S.crossTrix.length - 1]));
    if (S.crossZero.length) arr.push(Object.assign({ src: 'MACD零轴' }, S.crossZero[S.crossZero.length - 1]));
    if (S.div && S.div.length) {
      const d = S.div[S.div.length - 1];
      arr.push({
        src: d.type === 'top' ? '顶背离' : '底背离',
        i: d.i2,
        type: d.type === 'top' ? 'short' : 'long',
      });
    }
    if (!arr.length) return null;
    return arr.reduce((m, x) => x.i > m.i ? x : m, arr[0]);
  }

  function renderSide() {
    const { score, rows, maxScore } = judge();
    const r = maxScore ? score / maxScore : 0;  // 按项数归一
    let vd;
    if (r >= 0.72) vd = ['强烈看多', UP];
    else if (r >= 0.42) vd = ['看多', UP];
    else if (r >= 0.18) vd = ['偏多', UP];
    else if (r > -0.18) vd = ['震荡整理', '#e0b155'];
    else if (r > -0.42) vd = ['偏空', DOWN];
    else if (r > -0.72) vd = ['看空', DOWN];
    else vd = ['强烈看空', DOWN];
    el.vdMain.textContent = vd[0];
    el.vdMain.style.color = vd[1];
    el.vdTime.textContent = TF_NAME[S.tf];

    const pills = el.vdBar.querySelectorAll('i');
    const level = Math.max(0, Math.min(5, Math.round(Math.abs(r) * 5)));
    pills.forEach((p, idx) => {
      p.className = '';
      if (score > 0 && idx >= 5 - level) p.className = 'on-up';
      if (score < 0 && idx < level) p.className = 'on-down';
    });

    el.vdRows.innerHTML = rows.map(r =>
      '<div class="vd-row"><span class="k">' + r.k + '</span>' +
      '<span class="v"><em style="font-style:normal;color:var(--muted);font-size:11px">' +
      esc(r.v) + '</em><span class="tag ' +
      (r.tag === '多' ? 'long' : r.tag === '空' ? 'short' : 'neutral') + '">' + r.tag + '</span></span></div>'
    ).join('');

    // 信号列表
    const all = [];
    S.crossMacd.forEach(c => all.push({ i: c.i, type: c.type, src: 'MACD' }));
    S.crossTrix.forEach(c => all.push({ i: c.i, type: c.type, src: 'TRIX' }));
    S.crossZero.forEach(c => all.push({ i: c.i, type: c.type, src: 'MACD零轴' }));
    (S.div || []).forEach(d => all.push({
      i: d.i2, type: d.type === 'top' ? 'short' : 'long',
      src: d.type === 'top' ? '顶背离' : '底背离',
    }));
    all.sort((a, b) => b.i - a.i);
    const list = all.slice(0, 16);
    if (!list.length) {
      el.sigList.innerHTML = '<div style="color:var(--muted);font-size:12px;padding:6px">周期内暂无交叉信号</div>';
    } else {
      el.sigList.innerHTML = list.map(s => {
        const bar = S.bars[s.i];
        const long = s.type === 'long';
        return '<div class="sig-row">' +
          '<span class="bar" style="background:' + (long ? UP : DOWN) + '"></span>' +
          '<span class="lab"><span class="src">' + s.src + '</span>' +
          '<span class="tag ' + (long ? 'long' : 'short') + '">' + (long ? '多' : '空') + '</span></span>' +
          '<span class="p">' + fmtPrice(bar.c) + '</span>' +
          '<span class="t">' + fmtLabel(bar.t) + '</span></div>';
      }).join('');
    }

    renderStats();
  }

  function visibleBars() {
    const n = S.bars.length;
    if (!n) return { bars: [], from: 0, to: -1 };
    let from = 0, to = n - 1;
    if (S.zoom && S.zoom.n === n) {
      from = Math.max(0, Math.floor(S.zoom.start / 100 * n));
      to = Math.min(n - 1, Math.ceil(S.zoom.end / 100 * n) - 1);
      if (to - from < 5) { from = Math.max(0, n - 200); to = n - 1; }
    }
    return { bars: S.bars.slice(from, to + 1), from: from, to: to };
  }

  function renderStats() {
    const { bars } = visibleBars();
    if (!bars.length) return;
    const hi = Math.max.apply(null, bars.map(b => b.h));
    const lo = Math.min.apply(null, bars.map(b => b.l));
    const first = bars[0].o, last = bars[bars.length - 1].c;
    const chgPct = first ? (last - first) / first * 100 : 0;
    const amp = lo ? (hi - lo) / lo * 100 : 0;
    let trSum = 0, trCnt = 0;
    for (let i = Math.max(1, bars.length - 15); i < bars.length; i++) {
      const pc = bars[i - 1].c;
      trSum += Math.max(bars[i].h - bars[i].l, Math.abs(bars[i].h - pc), Math.abs(bars[i].l - pc));
      trCnt++;
    }
    const atr = trCnt ? trSum / trCnt : 0;
    const pos = hi > lo ? (last - lo) / (hi - lo) * 100 : 50;
    const d = digits(last);
    el.statRange.textContent = bars.length + ' 根';
    el.statBox.innerHTML = [
      ['区间涨跌', (chgPct >= 0 ? '+' : '') + num(chgPct, 2) + '%', chgPct >= 0 ? UP : DOWN],
      ['区间振幅', num(amp, 2) + '%', ''],
      ['最高', num(hi, d), ''],
      ['最低', num(lo, d), ''],
      ['当前分位', num(pos, 1) + '%', ''],
      ['ATR(14)', num(atr, d) + ' (' + num(atr / (last || 1) * 100, 2) + '%)', ''],
    ].map(x => '<div class="it"><label>' + x[0] + '</label><b' +
      (x[2] ? ' style="color:' + x[2] + '"' : '') + '>' + x[1] + '</b></div>').join('');
  }

  /* ---------------------------------------------------------------- 参数弹窗 */
  function openParams() {
    renderMaRows(S.p.mas);
    $('#macdFast').value = S.p.macd.fast;
    $('#macdSlow').value = S.p.macd.slow;
    $('#macdSig').value = S.p.macd.sig;
    $('#bollN').value = S.p.boll.n;
    $('#bollK').value = S.p.boll.k;
    $('#optBollDlg').checked = S.p.boll.on;
    $('#optMaDlg').checked = S.p.show.ma;
    $('#optZero').checked = S.p.show.zero !== false;
    $('#optDualColor').checked = S.p.show.dual !== false;
    $('#trixN').value = S.p.trix.n;
    $('#trixM').value = S.p.trix.m;
    $('#markCount').value = S.p.markCount;
    $('#divK').value = S.p.div.k;
    $('#divGap').value = S.p.div.gap;
    $('#divMax').value = S.p.div.max;
    $('#optDivDlg').checked = S.p.div.on !== false;
    $('#optVol').checked = S.p.show.vol;
    $('#optMacd').checked = S.p.show.macd;
    $('#optTrix').checked = S.p.show.trix;
    $('#optMark').checked = S.p.show.mark;
    $('#mask').classList.add('show');
    $('#dlgParams').classList.add('show');
  }
  function closeParams() {
    $('#mask').classList.remove('show');
    $('#dlgParams').classList.remove('show');
  }
  function renderMaRows(mas) {
    const box = $('#maRows');
    box.innerHTML = mas.map((m, i) =>
      '<div class="ma-row' + (m.on ? '' : ' disabled') + '" data-i="' + i + '">' +
      '<label class="switch"><input type="checkbox" data-k="on"' + (m.on ? ' checked' : '') +
      '><span></span></label>' +
      '<input type="number" data-k="p" min="1" max="500" value="' + m.p + '">' +
      '<select data-k="t"><option value="SMA"' + (m.t === 'SMA' ? ' selected' : '') + '>SMA</option>' +
      '<option value="EMA"' + (m.t === 'EMA' ? ' selected' : '') + '>EMA</option></select>' +
      '<input type="color" data-k="c" value="' + m.c + '">' +
      '<button class="del" title="删除">×</button></div>'
    ).join('');
    box.querySelectorAll('.ma-row').forEach(row => {
      const cb = row.querySelector('[data-k=on]');
      cb.addEventListener('change', () => row.classList.toggle('disabled', !cb.checked));
      row.querySelector('.del').addEventListener('click', () => {
        if (box.querySelectorAll('.ma-row').length <= 1) { toast('至少保留一条均线', 'info'); return; }
        row.remove();
      });
    });
  }
  function collectParams() {
    const mas = [];
    document.querySelectorAll('#maRows .ma-row').forEach(row => {
      const p = parseInt(row.querySelector('[data-k=p]').value, 10);
      mas.push({
        on: row.querySelector('[data-k=on]').checked,
        p: Math.max(1, Math.min(500, isNaN(p) ? 5 : p)),
        t: row.querySelector('[data-k=t]').value,
        c: row.querySelector('[data-k=c]').value,
      });
    });
    const gi = (sel, defv, min, max) => {
      let v = parseInt($(sel).value, 10);
      if (isNaN(v)) v = defv;
      return Math.max(min, Math.min(max, v));
    };
    return {
      mas: mas.length ? mas : JSON.parse(JSON.stringify(DEFAULTS.mas)),
      macd: {
        fast: gi('#macdFast', 12, 2, 200),
        slow: gi('#macdSlow', 26, 3, 400),
        sig: gi('#macdSig', 9, 1, 100),
      },
      trix: { n: gi('#trixN', 12, 2, 200), m: gi('#trixM', 9, 1, 100) },
      boll: {
        on: $('#optBollDlg').checked,
        n: gi('#bollN', 20, 2, 200),
        k: Math.max(0.3, Math.min(10, parseFloat($('#bollK').value) || 2)),
      },
      markCount: gi('#markCount', 8, 1, 30),
      div: {
        on: $('#optDivDlg').checked,
        k: gi('#divK', 3, 2, 20),
        gap: gi('#divGap', 5, 2, 120),
        max: gi('#divMax', 6, 1, 30),
      },
      show: {
        vol: $('#optVol').checked, macd: $('#optMacd').checked,
        trix: $('#optTrix').checked, mark: $('#optMark').checked,
        ma: $('#optMaDlg').checked,
        zero: $('#optZero').checked,
        dual: $('#optDualColor').checked,
      },
    };
  }

  /* ---------------------------------------------------------------- 事件 */
  function bind() {
    el.tfs.innerHTML = TFS.map(([k, n]) =>
      '<button data-tf="' + k + '"' + (k === S.tf ? ' class="on"' : '') + '>' + n + '</button>').join('');
    el.tfs.addEventListener('click', e => {
      const b = e.target.closest('button[data-tf]');
      if (!b) return;
      const tf = b.dataset.tf;
      if (tf === S.tf) return;
      S.tf = tf;
      S.zoom = null;
      el.tfs.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
      load();
    });

    el.btnLoad.addEventListener('click', () => applyCode(el.code.value, true));
    el.code.addEventListener('keydown', e => { if (e.key === 'Enter') applyCode(el.code.value, true); });
    el.sel.addEventListener('change', () => { el.code.value = el.sel.value; applyCode(el.sel.value, false); });

    el.autoRef.addEventListener('change', () => {
      S.autoRef = el.autoRef.checked;
      if (S.timer) { clearInterval(S.timer); S.timer = null; }
      if (S.autoRef) {
        S.timer = setInterval(() => {
          if (document.visibilityState === 'visible') load(true);
        }, 30000);
      }
      status(S.autoRef ? '<span class="ok">●</span> 自动刷新已开启（30 秒）' : '自动刷新已关闭');
    });

    $('#btnParams').addEventListener('click', openParams);
    $('#dlgClose').addEventListener('click', closeParams);
    $('#btnCancel').addEventListener('click', closeParams);
    $('#mask').addEventListener('click', closeParams);
    $('#btnAddMa').addEventListener('click', () => {
      const rows = document.querySelectorAll('#maRows .ma-row');
      if (rows.length >= 6) { toast('最多 6 条均线', 'info'); return; }
      const colors = ['#38d9a9', '#ff6b9d', '#7aa2ff', '#ffd166', '#a0e7e5', '#f78c6b'];
      const mas = collectParams().mas;
      mas.push({ on: false, p: 120, t: 'SMA', c: colors[mas.length % colors.length] });
      renderMaRows(mas);
    });
    $('#btnDefault').addEventListener('click', () => {
      renderMaRows(JSON.parse(JSON.stringify(DEFAULTS.mas)));
      $('#macdFast').value = DEFAULTS.macd.fast;
      $('#macdSlow').value = DEFAULTS.macd.slow;
      $('#macdSig').value = DEFAULTS.macd.sig;
      $('#bollN').value = DEFAULTS.boll.n;
      $('#bollK').value = DEFAULTS.boll.k;
      $('#optBollDlg').checked = DEFAULTS.boll.on;
      $('#optMaDlg').checked = DEFAULTS.show.ma;
      $('#optZero').checked = DEFAULTS.show.zero;
      $('#optDualColor').checked = DEFAULTS.show.dual;
      $('#trixN').value = DEFAULTS.trix.n;
      $('#trixM').value = DEFAULTS.trix.m;
      $('#markCount').value = DEFAULTS.markCount;
      $('#divK').value = DEFAULTS.div.k;
      $('#divGap').value = DEFAULTS.div.gap;
      $('#divMax').value = DEFAULTS.div.max;
      $('#optDivDlg').checked = DEFAULTS.div.on;
      $('#optVol').checked = DEFAULTS.show.vol;
      $('#optMacd').checked = DEFAULTS.show.macd;
      $('#optTrix').checked = DEFAULTS.show.trix;
      $('#optMark').checked = DEFAULTS.show.mark;
    });
    $('#btnSave').addEventListener('click', () => {
      S.p = collectParams();
      saveParams();
      closeParams();
      $('#optMa').checked = S.p.show.ma !== false;
      $('#optBoll').checked = !!S.p.boll.on;
      $('#optDiv').checked = S.p.div.on !== false;
      computeAll();
      renderChart();
      renderSide();
      renderLegend();
      toast('参数已应用', 'info');
    });

    /* ---- 画线工具栏 ---- */
    const dbTools = $('#drawTools');
    dbTools.addEventListener('click', e => {
      const b = e.target.closest('button[data-tool]');
      if (!b) return;
      dbTools.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
      if (S.draw) S.draw.setTool(b.dataset.tool);
    });
    $('#drawColors').addEventListener('click', e => {
      const b = e.target.closest('button[data-color]');
      if (!b) return;
      $('#drawColors').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
      if (S.draw) S.draw.setColor(b.dataset.color);
    });
    $('#drawWidths').addEventListener('click', e => {
      const b = e.target.closest('button[data-w]');
      if (!b) return;
      $('#drawWidths').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
      if (S.draw) S.draw.setWidth(parseInt(b.dataset.w, 10) || 1);
    });
    $('#drawbar').addEventListener('click', e => {
      const b = e.target.closest('.db-act');
      if (!b) return;
      const act = b.dataset.act;
      if (act === 'undo') {
        if (!S.draw || !S.draw.undo()) toast('没有可撤销的操作', 'info');
      } else if (act === 'del') {
        if (!S.draw || !S.draw.removeSelected()) toast('请先用“光标”选中一条画线', 'info');
      } else if (act === 'clear') {
        if (!S.draw) return;
        if (!S.draw.count()) { toast('当前周期没有画线', 'info'); return; }
        S.draw.clearAll();
        toast('已清空当前周期的画线', 'info');
      }
    });
    $('#drawVisible').addEventListener('change', () => {
      if (S.draw) S.draw.setVisible($('#drawVisible').checked);
    });
    $('#optMa').addEventListener('change', () => {
      S.p.show.ma = $('#optMa').checked;
      saveParams();
      renderChart();
      renderLegend();
    });
    $('#optDiv').addEventListener('change', () => {
      S.p.div.on = $('#optDiv').checked;
      saveParams();
      renderChart();
      renderLegend();
      toast(S.p.div.on ? '背离线已开启' : '背离线已关闭', 'info');
    });
    $('#optBoll').addEventListener('change', () => {
      S.p.boll.on = $('#optBoll').checked;
      saveParams();
      renderChart();
      renderLegend();
    });
    $('#btnBollCfg').addEventListener('click', () => {
      openParams();
      setTimeout(() => { const n = $('#bollN'); if (n) { n.focus(); n.select(); } }, 80);
    });

    let rz;
    window.addEventListener('resize', () => {
      clearTimeout(rz);
      rz = setTimeout(() => {
        if (S.chart) { S.chart.resize(); renderChart(); if (S.draw) S.draw.redraw(); }
      }, 200);
    });

    document.addEventListener('keydown', e => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test((document.activeElement || {}).tagName || '');
      if (e.key === 'Escape') {
        closeParams();
        if (S.draw) {
          S.draw.cancel();
          const sel = dbTools.querySelector('button[data-tool=select]');
          if (sel) { dbTools.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === sel)); }
          S.draw.setTool('select');
        }
      }
      if (typing) return;
      if ((e.key === 'Delete' || e.key === 'Backspace') && S.draw) {
        if (S.draw.removeSelected()) e.preventDefault();
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && S.draw) {
        e.preventDefault();
        S.draw.undo();
      }
      if (e.key === 'r' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); load(true); }
    });
  }

  function applyCode(raw, fromInput) {
    let c = String(raw || '').trim().toUpperCase().replace(/[^0-9A-Z]/g, '');
    if (!c) return;
    if (!/\d$/.test(c)) c += '0';
    S.code = c;
    S.zoom = null;
    el.code.value = c;
    const opt = Array.from(el.sel.options).find(o => o.value === c);
    if (opt) el.sel.value = c;
    load();
  }

  /* ============================================================ 左栏：直播 / 强弱 / 排行 */
  const LB_KEY = 'futures_pro_leftbar_v2';
  const LB_CH = 'futures_pro_livech_v1';
  const L = { ch: 'cn', live: [], lastTop: '', mkt: null, liveTimer: null, mktTimer: null, busy: false };
  const lb = {
    bar: $('#leftbar'), list: $('#liveList'), tabs: $('#liveTabs'), refresh: $('#liveRefresh'),
    grid: $('#gaugeGrid'), foot: $('#mktBreadth'), time: $('#mktTime'),
    long: $('#rankLong'), short: $('#rankShort'),
  };
  const pad2 = (n) => (n < 10 ? '0' : '') + n;

  /** 正文里的涨跌幅上红下绿（与 K 线配色一致） */
  function hlPct(txt) {
    let s = esc(txt);
    s = s.replace(/([+\-])(\d+(?:\.\d+)?%)/g, (m, sg) =>
      '<i class="' + (sg === '+' ? 'hl-up' : 'hl-down') + '">' + m + '</i>');
    s = s.replace(/(涨幅|上涨|上升|走高|反弹|涨)\s?(\d+(?:\.\d+)?%)/g,
      (m, w, n) => w + '<i class="hl-up">' + n + '</i>');
    s = s.replace(/(跌幅|下跌|下降|回落|走低|跌)\s?(\d+(?:\.\d+)?%)/g,
      (m, w, n) => w + '<i class="hl-down">' + n + '</i>');
    return s;
  }

  /* ---------------- 市场直播 ---------------- */
  async function fetchLive(force) {
    const ch = L.ch;
    try {
      const j = await getJSON('/api/live?ch=' + ch + '&limit=50');
      if (ch !== L.ch) return;
      renderLive(j);
    } catch (e) {
      if (!L.live.length) lb.list.innerHTML = '<div class="lb-empty">资讯获取失败，稍后自动重试</div>';
    } finally {
      if (force) setTimeout(() => lb.refresh.classList.remove('spin'), 350);
    }
  }

  function renderLive(j) {
    const items = (j && j.items) || [];
    if (!items.length) {
      if (!L.live.length) lb.list.innerHTML = '<div class="lb-empty">暂无快讯</div>';
      return;
    }
    const d = new Date();
    const mmdd = pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
    let cut = items.length;
    if (L.lastTop) {
      const i = items.findIndex(x => x.id === L.lastTop);
      cut = i < 0 ? 0 : i;
    }
    const sp = lb.list.scrollTop;
    lb.list.innerHTML = items.map((it, i) => {
      const older = (it.day || '') !== mmdd;
      const body = hlPct(it.body || '');
      const head = it.title ? '<span class="tt">' + esc(it.title) + '</span>' : '';
      return '<div class="live-item' + (i < cut ? ' new' : '') + (it.imp ? ' imp' : '') + '">' +
        '<div class="tm' + (older ? ' dim' : '') + '">' + esc(older ? (it.day || '') : it.hm) + '</div>' +
        '<div class="tx">' + head + body + '</div></div>';
    }).join('');
    L.lastTop = items[0].id;
    L.live = items;
    lb.list.scrollTop = sp;
  }

  /* ---------------- 板块强弱仪表 ---------------- */
  function polar(cx, cy, r, deg) {
    const a = deg * Math.PI / 180;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  }
  function arcPath(cx, cy, r, a0, a1) {
    const p0 = polar(cx, cy, r, a0), p1 = polar(cx, cy, r, a1);
    return 'M' + p0[0].toFixed(2) + ',' + p0[1].toFixed(2) +
      ' A' + r + ',' + r + ' 0 ' + ((a1 - a0) > 180 ? 1 : 0) + ' 1 ' +
      p1[0].toFixed(2) + ',' + p1[1].toFixed(2);
  }
  function scoreColor(v) { return v >= 6.8 ? '#f6465d' : v >= 4.2 ? '#e0b155' : '#0ecb81'; }

  function gaugeCell(s) {
    const v = Math.max(0, Math.min(10, s.score));
    const p = v / 10;
    const cx = 50, cy = 49, r = 32, a0 = 150, a1 = 390;
    const ang = a0 + (a1 - a0) * p;
    const dot = polar(cx, cy, r, ang);
    const full = arcPath(cx, cy, r, a0, a1);
    const cls = s.pct > 0 ? 'up' : s.pct < 0 ? 'down' : 'flat';
    const pct = (s.pct > 0 ? '+' : '') + s.pct.toFixed(2) + '%';
    const tips = [
      s.name + ' 强度 ' + v.toFixed(1) + '/10', '均涨跌 ' + pct,
      '上涨 ' + s.up + '/' + s.n,
      s.oiPct != null ? '增仓 ' + (s.oiPct > 0 ? '+' : '') + s.oiPct.toFixed(2) + '%' : '',
      '领涨 ' + s.lead, '领跌 ' + s.lag,
    ].filter(Boolean).join(' ｜ ');
    return '<div class="gauge" title="' + esc(tips) + '">' +
      '<svg viewBox="0 0 100 72">' +
      '<path d="' + full + '" fill="none" stroke="#18222f" stroke-width="6.5" stroke-linecap="round"/>' +
      '<path d="' + full + '" fill="none" stroke="url(#gaugeGrad)" stroke-width="6.5" stroke-linecap="round"' +
      ' pathLength="100" stroke-dasharray="' + (p * 100).toFixed(1) + ' 100"/>' +
      (p > 0.02 ? '<circle cx="' + dot[0].toFixed(1) + '" cy="' + dot[1].toFixed(1) + '" r="2.4" fill="#fff" opacity=".88"/>' : '') +
      '<text x="50" y="54" text-anchor="middle" font-size="19" font-weight="700" fill="' + scoreColor(v) + '">' + v.toFixed(1) + '</text>' +
      '<text x="17" y="70" text-anchor="middle" font-size="7.5" fill="#4b5f78">0</text>' +
      '<text x="83" y="70" text-anchor="middle" font-size="7.5" fill="#4b5f78">10</text>' +
      '</svg>' +
      '<div class="gn">' + esc(s.name) + '<em class="' + cls + '">' + pct + '</em></div>' +
      '</div>';
  }

  /* ---------------- 多空排行 ---------------- */
  function rankRow(r, i) {
    const cls = r.pct > 0 ? 'up' : r.pct < 0 ? 'down' : 'flat';
    const pct = (r.pct > 0 ? '+' : '') + r.pct.toFixed(2) + '%';
    const tips = [r.name + ' ' + r.code, '最新 ' + fmtPrice(r.last), '涨跌 ' + pct,
      '持仓 ' + fmtBig(r.oi),
      r.oiPct != null ? '增仓 ' + (r.oiPct > 0 ? '+' : '') + r.oiPct.toFixed(2) + '%' : '',
      '多空分 ' + r.score].filter(Boolean).join(' ｜ ');
    return '<div class="rk-row" data-code="' + esc(r.code) + '" title="' + esc(tips) + '">' +
      '<span class="i">' + (i + 1) + '</span>' +
      '<span class="n">' + esc(r.name) + '</span>' +
      '<span class="p ' + cls + '">' + pct + '</span></div>';
  }

  function renderMarket(m) {
    if (!m || !m.sectors || !m.sectors.length) return;
    L.mkt = m;
    S.mktAt = Date.now();
    lb.time.textContent = m.updated || '';
    lb.grid.innerHTML = m.sectors.map(gaugeCell).join('');
    const b = m.breadth || {};
    lb.foot.innerHTML =
      '<span>做多 <b class="up">' + (b.up || 0) + '</b></span>' +
      '<span>做空 <b class="down">' + (b.down || 0) + '</b></span>' +
      '<span>平盘 <b>' + (b.flat || 0) + '</b></span>' +
      '<span>' + (m.count || 0) + ' 品种</span>';
    lb.long.innerHTML = (m.longs || []).map(rankRow).join('');
    lb.short.innerHTML = (m.shorts || []).map(rankRow).join('');
  }

  async function fetchMarket(force) {
    try {
      const j = await getJSON('/api/market' + (force ? '?force=1' : ''));
      renderMarket(j);
    } catch (e) {
      if (!L.mkt) lb.grid.innerHTML = '<div class="lb-empty">板块行情加载失败</div>';
    }
  }

  /* ---------------- 交互与定时 ---------------- */
  function initLeft() {
    // 折叠状态
    let shown = true;
    try { shown = localStorage.getItem(LB_KEY) !== '0'; } catch (e) { }
    lb.bar.classList.toggle('hide', !shown);

    // 上次停留的频道
    try {
      const c = localStorage.getItem(LB_CH);
      if (c === 'global' || c === 'cn') L.ch = c;
    } catch (e) { }
    lb.tabs.querySelectorAll('button').forEach(x => x.classList.toggle('on', x.dataset.ch === L.ch));

    lb.tabs.addEventListener('click', e => {
      const b = e.target.closest('button[data-ch]');
      if (!b || b.dataset.ch === L.ch) return;
      L.ch = b.dataset.ch;
      try { localStorage.setItem(LB_CH, L.ch); } catch (e) { }
      lb.tabs.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
      L.lastTop = '';
      L.live = [];
      lb.list.innerHTML = '<div class="lb-empty">切换到' + (L.ch === 'global' ? '环球' : '国内') + '资讯…</div>';
      fetchLive();
    });

    lb.refresh.addEventListener('click', () => {
      lb.refresh.classList.add('spin');
      fetchLive(true);
      fetchMarket(true);
    });

    [lb.long, lb.short].forEach(box => {
      box.addEventListener('click', e => {
        const row = e.target.closest('.rk-row[data-code]');
        if (row) applyCode(row.dataset.code, false);
      });
    });

    $('#btnLeft').addEventListener('click', () => {
      const hidden = lb.bar.classList.toggle('hide');
      try { localStorage.setItem(LB_KEY, hidden ? '0' : '1'); } catch (e) { }
      setTimeout(() => {
        if (S.chart) { S.chart.resize(); renderChart(); if (S.draw) S.draw.redraw(); }
      }, 50);
    });

    fetchLive();
    fetchMarket();
    L.liveTimer = setInterval(() => {
      if (document.visibilityState === 'visible') fetchLive();
    }, 60000);
    L.mktTimer = setInterval(() => {
      if (document.visibilityState === 'visible') fetchMarket();
    }, 30000);

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - (S.mktAt || 0) > 40000) fetchMarket();
      fetchLive();
    });
  }

  /* ---------------------------------------------------------------- 启动 */
  async function init() {
    S.p = loadParams();
    bind();
    initDraw();
    renderLegend();
    $('#optMa').checked = S.p.show.ma !== false;
    $('#optBoll').checked = !!S.p.boll.on;
    $('#optDiv').checked = S.p.div.on !== false;

    // 支持 ?code=RB0&tf=1m 深链
    try {
      const q = new URLSearchParams(location.search);
      const qc = q.get('code'); const qt = q.get('tf');
      if (qc) S.code = String(qc).toUpperCase();
      if (qt && TF_NAME[qt]) {
        S.tf = qt;
        el.tfs.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.tf === qt));
      }
    } catch (e) { }

    await loadCatalog();
    el.sel.value = S.code;
    el.code.value = S.code;
    load();
    initLeft();

    // 心跳：让桌面启动器知道窗口还开着
    setInterval(() => {
      fetch('/api/hb', { cache: 'no-store' }).catch(() => { });
    }, 5000);
    window.addEventListener('pagehide', () => {
      try { navigator.sendBeacon('/api/bye'); } catch (e) { }
    });
  }

  init();
})();
