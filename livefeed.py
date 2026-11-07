# -*- coding: utf-8 -*-
"""
市场资讯与全市场温度
------------------------------------------------------------------
1) 市场直播：7x24 财经快讯（金十数据），按内容自动分为「环球 / 国内」
2) 板块强弱：把主力连续合约按板块聚合，算 0~10 的强弱分（参考强弱仪表盘）
3) 多空排行：全市场品种多空评分，输出做多前五 / 做空前五
数据源：flash-api.jin10.com（快讯）、hq.sinajs.cn（批量行情）
"""
import html
import json
import math
import os
import re
import threading
import time
import urllib.parse
import urllib.request
from datetime import datetime

import datafeed

UA = datafeed.UA

JIN10_URL = "https://flash-api.jin10.com/get_flash_list?channel=-8200&vip=1"
JIN10_HEAD = {"x-app-id": "bVBF4FyRTn5NJF5n", "x-version": "1.0.0"}

# 板块划分（每个品种只归一个板块，保证排行去重）
SECTOR_MAP = [
    ("黑色", ["RB0", "HC0", "I0", "J0", "JM0", "SF0", "SM0", "SS0"]),
    ("有色", ["CU0", "AL0", "ZN0", "PB0", "NI0", "SN0", "BC0"]),
    ("能化", ["SC0", "FU0", "BU0", "TA0", "MA0", "EG0", "PP0", "L0", "V0",
              "EB0", "PG0", "SA0", "FG0", "UR0", "RU0", "SP0", "PX0", "SH0",
              "LU0", "NR0", "BR0"]),
    ("农产品", ["M0", "Y0", "P0", "A0", "B0", "C0", "CS0", "JD0", "LH0",
                "SR0", "CF0", "OI0", "RM0", "AP0", "CJ0", "PK0", "CY0"]),
    ("贵金属", ["AU0", "AG0"]),
    ("股指", ["IF0", "IH0", "IC0", "IM0"]),
]

# 排行里排除波动极小、对多空判断意义不大的品种
RANK_SKIP = {"T0", "TF0", "TS0", "TL0", "FB0", "BB0", "RR0", "RS0", "CY0"}

# ---------------------------------------------------------------- 地域分类词表
GLOBAL_WORDS = (
    "美联储", "美国", "美元", "美债", "美股", "纳指", "纳斯达克", "道指", "道琼斯",
    "标普", "白宫", "特朗普", "鲍威尔", "非农", "FOMC", "欧洲", "欧元", "欧央行",
    "拉加德", "欧盟", "英国", "英镑", "英央行", "日本", "日元", "日央行", "韩国",
    "印度", "俄罗斯", "乌克兰", "以色列", "伊朗", "加沙", "中东", "沙特", "OPEC",
    "欧佩克", "原油", "WTI", "布伦特", "黄金", "白银", "COMEX", "伦敦", "伦铜",
    "德国", "法国", "意大利", "加拿大", "澳大利亚", "澳洲", "巴西", "土耳其",
    "墨西哥", "阿根廷", "瑞士", "瑞典", "挪威", "海外", "境外", "外盘", "离岸",
    "全球市场", "国际市场", "世贸", "WTO", "IMF", "世界银行", "联合国", "关税",
    "卢布", "比索", "加元", "澳元", "纽约", "芝加哥", "亚太", "欧洲央行",
    "波兰", "荷兰", "西班牙", "希腊", "葡萄牙", "爱尔兰", "芬兰", "丹麦",
    "比利时", "奥地利", "匈牙利", "捷克", "罗马尼亚", "保加利亚", "塞尔维亚",
    "新加坡", "越南", "泰国", "印尼", "马来西亚", "菲律宾", "新西兰", "南非",
    "埃及", "尼日利亚", "智利", "秘鲁", "委内瑞拉", "哥伦比亚", "古巴", "朝鲜",
    "蒙古", "哈萨克斯坦", "巴基斯坦", "阿富汗", "叙利亚", "伊拉克", "黎巴嫩",
    "卡塔尔", "阿联酋", "科威特", "也门", "白俄罗斯", "格鲁吉亚", "亚美尼亚",
    "北约", "G20", "G7", "普京", "泽连斯基", "拜登", "马克龙", "朔尔茨",
    "石破茂", "拉夫罗夫", "鲁比奥", "博索纳罗", "米莱", "莫迪", "斯塔默",
    "美元指数", "海外市场", "国际油价", "国际金价", "美豆", "美玉米", "美棉",
)
CN_WORDS = (
    "A股", "沪指", "上证", "深证", "深成", "创业板", "科创板", "沪深", "北证",
    "两市", "我国", "国内", "人民银行", "国常会", "国务院", "发改委",
    "工信部", "财政部", "商务部", "证监会", "统计局", "郑商所", "大商所",
    "上期所", "中金所", "广期所", "人民币", "港股", "恒生", "北向", "期货",
    "夜盘", "主力合约", "保证金", "涨跌停", "沪深300", "中证500", "中证1000",
    "上证50", "中国", "钢材", "铁矿石", "焦煤", "焦炭", "螺纹", "地产",
    "楼市", "基建", "专项债", "PMI", "社融", "LPR", "降准", "降息",
)

_cache = {}
_lock = threading.Lock()


def _cached(key, ttl, fn):
    now = time.time()
    with _lock:
        hit = _cache.get(key)
    if hit and now - hit[0] < ttl:
        return hit[1]
    val = fn()
    with _lock:
        _cache[key] = (now, val)
    return val


def _get(url, referer, headers=None, timeout=12, encoding="utf-8"):
    h = {"User-Agent": UA, "Referer": referer, "Accept": "*/*"}
    if headers:
        h.update(headers)
    req = urllib.request.Request(url, headers=h)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode(encoding, "ignore")


# ================================================================ 市场直播
def _clean(s):
    s = re.sub(r"<br\s*/?>", " ", s or "")
    s = re.sub(r"<[^>]+>", "", s)
    s = html.unescape(s)
    s = s.replace("\u3000", " ").replace("\xa0", " ")
    return re.sub(r"\s+", " ", s).strip()


def _split_title(txt):
    """金十正文形如「【标题】金十数据10月31日讯，……」"""
    m = re.match(r"^【(.{2,60}?)】\s*(.*)$", txt)
    if m:
        return m.group(1).strip(), _strip_prefix(m.group(2))
    return "", _strip_prefix(txt)


def _strip_prefix(s):
    return re.sub(r"^金十数据\s*\d+月\d+日讯[，,：:]\s*", "", s or "").strip()


def _region(title, body):
    """判定一条快讯属于 环球 / 国内 / 两者都算"""
    t = title + " " + body
    g = sum(1 for w in GLOBAL_WORDS if w in t)
    c = sum(1 for w in CN_WORDS if w in t)
    if g and c:
        if g > c:
            return "global"
        if c > g:
            return "cn"
        return "both"
    if g:
        return "global"
    return "cn"


def _jin10_page(max_time=None):
    url = JIN10_URL
    if max_time:
        url += "&max_time=" + urllib.parse.quote(str(max_time))
    raw = _get(url, "https://www.jin10.com/", JIN10_HEAD, encoding="utf-8")
    return json.loads(raw).get("data") or []


def _fetch_live_raw(pages=3):
    out, seen, mt = [], set(), None
    for _ in range(max(1, pages)):
        try:
            rows = _jin10_page(mt)
        except Exception:
            break
        if not rows:
            break
        for it in rows:
            d = it.get("data") or {}
            if (it.get("extras") or {}).get("ad"):
                continue
            txt = _clean(d.get("content") or "")
            if not txt or len(txt) < 8:
                continue
            if "盯盘神器" in txt[:30]:        # 金十推广位
                continue
            key = txt[:26]
            if key in seen:
                continue
            seen.add(key)
            tm = str(it.get("time") or "")
            title, body = _split_title(txt)
            ch = _region(title, body)
            out.append({
                "id": str(it.get("id") or key),
                "time": tm,
                "hm": tm[11:16] if len(tm) >= 16 else tm,
                "day": tm[5:10] if len(tm) >= 10 else "",
                "title": title,
                "body": body if len(body) > 1 else "",
                "imp": int(it.get("important") or 0),
                "ch": ch,
            })
        mt = rows[-1].get("time")
    out.sort(key=lambda x: x.get("time") or "", reverse=True)
    return out


def get_live(ch="cn", limit=60):
    """ch: global=环球 / cn=国内"""
    rows = _cached("live", 55, _fetch_live_raw)
    if ch == "global":
        sel = [r for r in rows if r["ch"] in ("global", "both")]
    elif ch == "cn":
        sel = [r for r in rows if r["ch"] in ("cn", "both")]
    else:
        sel = rows
    if len(sel) < 6:                      # 兜底，避免空面板
        sel = rows
    return {
        "ok": True,
        "channel": ch,
        "updated": datetime.now().strftime("%H:%M:%S"),
        "total": len(rows),
        "items": sel[:limit],
    }


# ================================================================ 批量行情
def _parse_nf(line):
    m = re.search(r'hq_str_nf_([A-Za-z0-9]+)="(.*)";', line)
    if not m:
        return None
    code, body = m.group(1).upper(), m.group(2)
    if not body.strip():
        return None
    p = body.split(",")
    try:
        if re.match(r"^-?[\d.]+$", p[0]):          # 金融期货（股指 / 国债）
            if len(p) < 15:
                return None
            last = float(p[3])
            prev = float(p[14] or 0) or float(p[13] or 0)
            vol = float(p[4] or 0)
            oi = float(p[6] or 0)
            name = datafeed.NAME_MAP.get(code, code)
            t = p[1] if len(p) > 1 else ""
            date = ""
        else:                                       # 商品期货
            if len(p) < 18:
                return None
            last = float(p[8])
            prev = float(p[10] or 0)
            oi = float(p[13] or 0)
            vol = float(p[14] or 0)
            name = (p[16] or p[0]).replace("连续", "") or datafeed.NAME_MAP.get(code, code)
            t = p[1]
            date = p[17]
    except Exception:
        return None
    if last <= 0:
        return None
    pct = (last - prev) / prev * 100.0 if prev > 0 else 0.0
    return {"code": code, "name": name, "last": last, "prev": prev,
            "pct": pct, "vol": vol, "oi": oi,
            "time": datafeed._fmt_time(t) if t else "", "date": date}


def _batch_quotes(codes):
    out = {}
    for i in range(0, len(codes), 30):
        chunk = codes[i:i + 30]
        url = "https://hq.sinajs.cn/list=" + ",".join("nf_" + c for c in chunk)
        try:
            txt = _get(url, "https://finance.sina.com.cn/", encoding="gbk")
        except Exception:
            continue
        for line in txt.split("\n"):
            q = _parse_nf(line.strip())
            if q:
                out[q["code"]] = q
    return out


# ---------------------------------------------------------------- 持仓基准
def _state_dir():
    base = os.environ.get("LOCALAPPDATA") or os.path.expanduser("~")
    d = os.path.join(base, "FuturesPro")
    try:
        os.makedirs(d, exist_ok=True)
    except Exception:
        pass
    return d


def _oi_store_path():
    return os.path.join(_state_dir(), "oi_history.json")


def _load_oi_history():
    try:
        with open(_oi_store_path(), "r", encoding="utf-8") as f:
            d = json.load(f)
        return d if isinstance(d, dict) else {}
    except Exception:
        return {}


def _save_oi_history(d):
    try:
        tmp = _oi_store_path() + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(d, f, ensure_ascii=False)
        os.replace(tmp, _oi_store_path())
    except Exception:
        pass


def _kline_prev_oi(code, cur_date):
    """兜底：从日线本地缓存里取「上一交易日」的持仓量"""
    try:
        path = os.path.join(datafeed._cache_dir(), "%s_1d.json" % code)
        with open(path, "r", encoding="utf-8") as f:
            bars = (json.load(f) or {}).get("bars") or []
        for b in reversed(bars):
            if str(b.get("t", ""))[:10] < cur_date and b.get("oi"):
                return float(b["oi"])
    except Exception:
        pass
    return None


def _attach_oi_change(quotes):
    """计算每个品种相对上一交易日的持仓变化（手 / 百分比）"""
    today, need = _resolve_base(quotes)
    for code, q in quotes.items():
        base = _base["vals"].get(code)
        if base and base > 0 and q.get("oi"):
            q["oiChg"] = q["oi"] - base
            q["oiPct"] = (q["oi"] - base) / base * 100.0
        else:
            q["oiChg"], q["oiPct"] = None, None

    hist = _load_oi_history()
    hist[today] = {c: (q.get("oi") or 0) for c, q in quotes.items()}
    for day in sorted(hist.keys())[:-3]:
        hist.pop(day, None)
    _save_oi_history(hist)

    if len(need) >= 8:
        _warm_oi(need)
    return quotes


_base = {"day": "", "vals": {}, "tried": set(), "warming": False, "warm_tries": 0}


def _resolve_base(quotes):
    """每个交易日只解析一次「上一交易日持仓」；缺失的先读本地日线缓存"""
    today = datetime.now().strftime("%Y-%m-%d")
    if _base["day"] != today:
        hist = _load_oi_history()
        prev = {}
        for d in sorted(hist.keys()):
            if d < today:
                prev = hist[d] or {}
        _base["vals"] = dict(prev)
        _base["tried"] = set()
        _base["day"] = today
    need = []
    for code, q in quotes.items():
        if _base["vals"].get(code):
            continue
        if code not in _base["tried"]:
            _base["tried"].add(code)
            v = _kline_prev_oi(code, q.get("date") or today)
            if v:
                _base["vals"][code] = v
                continue
        need.append(code)
    return today, need


def _warm_oi(codes):
    """后台补齐缺失的日线缓存，下一次刷新即可显示增仓（每个交易日最多两次）"""
    if _base["warming"] or _base["warm_tries"] >= 2 or len(_base["vals"]) > 40:
        return
    _base["warming"] = True
    _base["warm_tries"] += 1

    def run():
        time.sleep(6)          # 让首屏 K 线先加载完
        try:
            from concurrent.futures import ThreadPoolExecutor
            with ThreadPoolExecutor(max_workers=5) as ex:
                list(ex.map(_safe_bars, codes[:80]))
        except Exception:
            pass
        _base["tried"] = set()
        _base["warming"] = False
        with _lock:
            _cache.pop("market", None)

    threading.Thread(target=run, daemon=True).start()


def _safe_bars(code):
    try:
        datafeed.get_bars(code, "1d")
    except Exception:
        pass


# ================================================================ 市场温度
def _all_codes():
    codes = []
    for _, items in datafeed.CATALOG:
        for c, _n in items:
            if c not in RANK_SKIP:
                codes.append(c)
    return codes


def compute_market():
    quotes = _attach_oi_change(_batch_quotes(_all_codes()))
    if not quotes:
        raise RuntimeError("批量行情获取失败")

    sectors = []
    for name, codes in SECTOR_MAP:
        vals = [quotes[c] for c in codes if c in quotes]
        if not vals:
            continue
        n = len(vals)
        avg = sum(v["pct"] for v in vals) / n
        up = sum(1 for v in vals if v["pct"] > 0)
        down = sum(1 for v in vals if v["pct"] < 0)
        ratio = up / n
        s_pct = 5 + 5 * math.tanh(avg / 1.2)          # 涨跌幅映射到 0~10
        score = 0.62 * s_pct + 0.38 * (ratio * 10)    # 再叠加上涨家数占比
        score = max(0.0, min(10.0, score))
        ois = [v["oiPct"] for v in vals if v.get("oiPct") is not None]
        sectors.append({
            "name": name, "score": round(score, 1),
            "pct": round(avg, 2), "up": up, "down": down, "n": n,
            "oiPct": round(sum(ois) / len(ois), 2) if ois else None,
            "lead": max(vals, key=lambda v: v["pct"])["name"],
            "lag": min(vals, key=lambda v: v["pct"])["name"],
        })

    rows = []
    for q in quotes.values():
        chg = q.get("oiPct")
        score = q["pct"] + (chg * 0.08 if chg is not None else 0.0)
        rows.append({
            "code": q["code"], "name": q["name"], "pct": round(q["pct"], 2),
            "last": q["last"], "oi": q["oi"],
            "oiChg": q.get("oiChg"), "oiPct": (round(chg, 2) if chg is not None else None),
            "score": round(score, 2),
        })
    rows.sort(key=lambda x: -x["score"])

    up = sum(1 for q in quotes.values() if q["pct"] > 0)
    down = sum(1 for q in quotes.values() if q["pct"] < 0)
    return {
        "ok": True,
        "updated": datetime.now().strftime("%H:%M:%S"),
        "count": len(quotes),
        "sectors": sectors,
        "longs": rows[:5],
        "shorts": list(reversed(rows[-5:])),
        "breadth": {"up": up, "down": down, "flat": len(quotes) - up - down},
    }


def get_market(force=False):
    if force:
        with _lock:
            _cache.pop("market", None)
    return _cached("market", 25, compute_market)
