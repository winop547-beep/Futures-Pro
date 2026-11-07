# -*- coding: utf-8 -*-
"""
数据层：期货行情获取 / 周期重采样 / 本地缓存
数据源：新浪财经（主）、东方财富（备）
"""
import json
import os
import re
import threading
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36")

TIMEFRAMES = ["1m", "5m", "15m", "30m", "60m", "2h", "4h", "1d", "1w"]
TF_LABEL = {
    "1m": "1分钟", "5m": "5分钟", "15m": "15分钟", "30m": "30分钟",
    "60m": "1小时", "2h": "2小时", "4h": "4小时", "1d": "日线", "1w": "周线",
}

# ---------------------------------------------------------------- 品种清单
CATALOG = [
    ("上期所", [
        ("RB0", "螺纹钢"), ("HC0", "热卷"), ("SS0", "不锈钢"), ("CU0", "沪铜"),
        ("AL0", "沪铝"), ("ZN0", "沪锌"), ("PB0", "沪铅"), ("NI0", "沪镍"),
        ("SN0", "沪锡"), ("AU0", "沪金"), ("AG0", "沪银"), ("RU0", "橡胶"),
        ("BU0", "沥青"), ("FU0", "燃油"), ("SP0", "纸浆"), ("BR0", "丁二烯橡胶"),
    ]),
    ("能源中心", [
        ("SC0", "原油"), ("LU0", "低硫燃料油"), ("NR0", "20号胶"),
        ("BC0", "国际铜"), ("EC0", "集运欧线"),
    ]),
    ("大商所", [
        ("I0", "铁矿石"), ("J0", "焦炭"), ("JM0", "焦煤"), ("M0", "豆粕"),
        ("Y0", "豆油"), ("P0", "棕榈油"), ("A0", "豆一"), ("B0", "豆二"),
        ("C0", "玉米"), ("CS0", "玉米淀粉"), ("JD0", "鸡蛋"), ("L0", "塑料"),
        ("V0", "PVC"), ("PP0", "聚丙烯"), ("EG0", "乙二醇"), ("EB0", "苯乙烯"),
        ("PG0", "液化气"), ("RR0", "粳米"), ("LH0", "生猪"), ("FB0", "纤维板"),
        ("BB0", "胶合板"),
    ]),
    ("郑商所", [
        ("SR0", "白糖"), ("CF0", "棉花"), ("TA0", "PTA"), ("MA0", "甲醇"),
        ("FG0", "玻璃"), ("SA0", "纯碱"), ("UR0", "尿素"), ("SF0", "硅铁"),
        ("SM0", "锰硅"), ("AP0", "苹果"), ("CJ0", "红枣"), ("PF0", "短纤"),
        ("PK0", "花生"), ("OI0", "菜油"), ("RM0", "菜粕"), ("RS0", "菜籽"),
        ("CY0", "棉纱"), ("SH0", "烧碱"), ("PX0", "对二甲苯"), ("PR0", "瓶片"),
    ]),
    ("中金所", [
        ("IF0", "沪深300"), ("IH0", "上证50"), ("IC0", "中证500"),
        ("IM0", "中证1000"), ("T0", "10年国债"), ("TF0", "5年国债"),
        ("TS0", "2年国债"), ("TL0", "30年国债"),
    ]),
    ("广期所", [
        ("SI0", "工业硅"), ("LC0", "碳酸锂"), ("PS0", "多晶硅"),
    ]),
]

NAME_MAP = {c: n for _, items in CATALOG for c, n in items}


# ---------------------------------------------------------------- 基础工具
def _cache_dir():
    base = os.environ.get("LOCALAPPDATA") or os.path.expanduser("~")
    d = os.path.join(base, "FuturesPro", "klcache")
    try:
        os.makedirs(d, exist_ok=True)
    except Exception:
        pass
    return d


def _fetch(url, referer="https://finance.sina.com.cn/", timeout=12, encoding="gbk"):
    req = urllib.request.Request(url, headers={
        "User-Agent": UA,
        "Referer": referer,
        "Accept": "*/*",
    })
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read().decode(encoding, "ignore")


def norm_code(raw):
    """把用户输入规整为新浪代码，如 rb -> RB0, rb2601 -> RB2601"""
    if not raw:
        return ""
    s = re.sub(r"[^0-9A-Za-z]", "", str(raw)).upper()
    if not s:
        return ""
    if re.search(r"\d$", s):
        return s
    return s + "0"


def _sina_jsonp(text):
    """从 `var _K=([{...}]);` 这类 jsonp 文本中取出 JSON 主体"""
    i = text.find("=")
    if i < 0:
        raise ValueError("数据格式异常")
    j = text.find("[", i)
    k = text.find("{", i)
    if j < 0 or (0 <= k < j):
        j = k
    if j < 0:
        raise ValueError("数据格式异常")
    body = text[j:].strip()
    while body and body[-1] in ");;\r\n\t ":
        body = body[:-1]
    return json.loads(body)


# ---------------------------------------------------------------- 重采样
def resample_by_count(bars, n):
    """按固定根数合并（用于 60m -> 2h/4h），跨交易日断开"""
    if n <= 1 or not bars:
        return list(bars)
    out, cur = [], []
    cur_day = None
    for b in bars:
        day = b["t"][:10]
        if cur and (day != cur_day or len(cur) >= n):
            out.append(_merge(cur))
            cur = []
        cur_day = day
        cur.append(b)
    if cur:
        out.append(_merge(cur))
    return out


def resample_by_week(bars):
    """日线 -> 周线（按自然周聚合）"""
    out, cur, cur_key = [], [], None
    for b in bars:
        try:
            d = datetime.strptime(b["t"][:10], "%Y-%m-%d")
            key = d.isocalendar()[:2]
        except Exception:
            key = None
        if cur and key != cur_key:
            out.append(_merge(cur))
            cur = []
        cur_key = key
        cur.append(b)
    if cur:
        out.append(_merge(cur))
    return out


def _merge(group):
    first, last = group[0], group[-1]
    return {
        "t": last["t"],
        "o": first["o"],
        "h": max(b["h"] for b in group),
        "l": min(b["l"] for b in group),
        "c": last["c"],
        "v": sum(b["v"] for b in group),
        "oi": last["oi"],
    }


# ---------------------------------------------------------------- 数据源
def fetch_sina(code, tf):
    if tf in ("1m", "5m", "15m", "30m", "60m"):
        t = int(tf[:-1])
        url = ("https://stock2.finance.sina.com.cn/futures/api/jsonp.php/"
               f"var%20_K=/InnerFuturesNewService.getFewMinLine?symbol={code}&type={t}")
        rows = _sina_jsonp(_fetch(url))
        bars = []
        for r in rows:
            bars.append({
                "t": r.get("d", ""), "o": float(r["o"]), "h": float(r["h"]),
                "l": float(r["l"]), "c": float(r["c"]),
                "v": float(r.get("v") or 0), "oi": float(r.get("p") or 0),
            })
        return bars

    url = ("https://stock2.finance.sina.com.cn/futures/api/jsonp.php/"
           f"var%20_K=/InnerFuturesNewService.getDailyKLine?symbol={code}")
    rows = _sina_jsonp(_fetch(url))
    bars = []
    for r in rows:
        bars.append({
            "t": r.get("d", ""), "o": float(r["o"]), "h": float(r["h"]),
            "l": float(r["l"]), "c": float(r["c"]),
            "v": float(r.get("v") or 0), "oi": float(r.get("p") or 0),
        })
    return bars


EM_KLT = {"1m": 1, "5m": 5, "15m": 15, "30m": 30, "60m": 60,
          "2h": 120, "4h": 240, "1d": 101, "1w": 102}
EM_MARKET = {"RB": 113, "HC": 113, "SS": 113, "CU": 113, "AL": 113, "ZN": 113,
             "PB": 113, "NI": 113, "SN": 113, "AU": 113, "AG": 113, "RU": 113,
             "BU": 113, "FU": 113, "SP": 113, "BR": 113,
             "SC": 142, "LU": 142, "NR": 142, "BC": 142, "EC": 142,
             "I": 114, "J": 114, "JM": 114, "M": 114, "Y": 114, "P": 114,
             "A": 114, "B": 114, "C": 114, "CS": 114, "JD": 114, "L": 114,
             "V": 114, "PP": 114, "EG": 114, "EB": 114, "PG": 114, "RR": 114,
             "LH": 114, "FB": 114, "BB": 114,
             "SR": 115, "CF": 115, "TA": 115, "MA": 115, "FG": 115, "SA": 115,
             "UR": 115, "SF": 115, "SM": 115, "AP": 115, "CJ": 115, "PF": 115,
             "PK": 115, "OI": 115, "RM": 115, "RS": 115, "CY": 115, "SH": 115,
             "PX": 115, "PR": 115,
             "IF": 8, "IH": 8, "IC": 8, "IM": 8, "T": 8, "TF": 8, "TS": 8, "TL": 8,
             "SI": 225, "LC": 225, "PS": 225}


def fetch_eastmoney(code, tf):
    m = re.match(r"^([A-Za-z]+)(\d*)$", code)
    if not m:
        raise ValueError("代码无效")
    prod, contract = m.group(1).upper(), m.group(2)
    market = EM_MARKET.get(prod)
    if not market:
        raise ValueError("未知品种")
    if contract in ("", "0"):
        em_code = prod.lower() + "m"          # 主力连续
    else:
        em_code = prod.lower() + contract
    secid = "%d.%s" % (market, em_code)
    url = ("https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=%s"
           "&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57"
           "&klt=%d&fqt=1&beg=0&end=20500101&lmt=1000"
           % (secid, EM_KLT[tf]))
    txt = _fetch(url, referer="https://quote.eastmoney.com/", encoding="utf-8")
    data = json.loads(txt)
    if not data.get("data") or not data["data"].get("klines"):
        raise ValueError("东财无数据")
    bars = []
    for line in data["data"]["klines"]:
        p = line.split(",")
        bars.append({
            "t": p[0], "o": float(p[1]), "c": float(p[2]), "h": float(p[3]),
            "l": float(p[4]), "v": float(p[5] or 0), "oi": 0.0,
        })
    return bars


def clean_bars(bars):
    """清洗：去掉零值、重复、时间倒挂以及时间落在未来的异常K线"""
    now = datetime.now()
    limit = now + timedelta(hours=8)
    out = []
    last = None
    for b in bars:
        t = str(b.get("t") or "")
        try:
            dt = (datetime.strptime(t, "%Y-%m-%d %H:%M:%S") if len(t) > 10
                  else datetime.strptime(t, "%Y-%m-%d"))
        except Exception:
            continue
        if dt > limit:
            continue
        if last is not None and dt <= last:
            continue
        if not (b.get("c") or 0) > 0 or not (b.get("h") or 0) > 0:
            continue
        out.append(b)
        last = dt
    return out


# ---------------------------------------------------------------- 缓存与调度
_lock = threading.Lock()
_mem = {}


def get_bars(code, tf, force=False):
    """返回 (bars, meta) ；meta 含 source / updated / cached"""
    code = norm_code(code)
    if tf not in TIMEFRAMES:
        raise ValueError("周期无效")
    key = (code, tf)
    now = time.time()
    ttl = 45 if tf in ("1m", "5m") else 120

    if not force:
        with _lock:
            hit = _mem.get(key)
        if hit and now - hit[0] < ttl:
            return hit[1], hit[2]

    source, bars, err = None, None, None
    try:
        base_tf = {"2h": "60m", "4h": "60m", "1w": "1d"}.get(tf, tf)
        raw = fetch_sina(code, base_tf)
        if tf == "2h":
            bars = resample_by_count(raw, 2)
        elif tf == "4h":
            bars = resample_by_count(raw, 4)
        elif tf == "1w":
            bars = resample_by_week(raw)
        else:
            bars = raw
        source = "新浪财经"
    except Exception as e1:
        err = e1
        try:
            bars = fetch_eastmoney(code, tf)
            source = "东方财富"
        except Exception as e2:
            # 全部失败 -> 读磁盘缓存
            cached = _read_disk(key)
            if cached:
                meta = {"code": code, "tf": tf, "source": cached.get("source", "本地缓存"),
                        "updated": cached.get("updated", ""), "cached": True,
                        "name": NAME_MAP.get(code, code),
                        "notice": "数据源暂不可用，显示最后一次成功获取的数据"}
                with _lock:
                    _mem[key] = (now - ttl + 10, cached["bars"], meta)
                return cached["bars"], meta
            raise RuntimeError("行情获取失败：%s / %s" % (err, e2))

    bars = clean_bars(bars)
    if not bars:
        raise RuntimeError("行情数据为空")
    meta = {
        "code": code, "tf": tf, "source": source,
        "updated": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "cached": False, "name": NAME_MAP.get(code, code), "count": len(bars),
    }
    with _lock:
        _mem[key] = (now, bars, meta)
    _write_disk(key, bars, meta)
    return bars, meta


def _disk_path(key):
    return os.path.join(_cache_dir(), "%s_%s.json" % key)


def _write_disk(key, bars, meta):
    try:
        payload = {"bars": bars[-3000:], "source": meta["source"],
                   "updated": meta["updated"]}
        tmp = _disk_path(key) + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False)
        os.replace(tmp, _disk_path(key))
    except Exception:
        pass


def _read_disk(key):
    try:
        with open(_disk_path(key), "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None


# ---------------------------------------------------------------- 实时报价
def get_quote(code):
    code = norm_code(code)
    out = {"code": code, "name": NAME_MAP.get(code, code)}
    try:
        txt = _fetch("https://hq.sinajs.cn/list=nf_%s" % code)
        m = re.search(r'="(.*)";', txt)
        if not m or not m.group(1).strip():
            raise ValueError("无报价")
        p = m.group(1).split(",")
        if re.match(r"^-?[\d.]+$", p[0]):          # 金融期货格式
            dstr = next((x for x in p if re.match(r"^\d{4}-\d{2}-\d{2}$", x)), "")
            tstr = next((x for x in p if re.match(r"^\d{2}:\d{2}:\d{2}$", x)), "")
            out.update({
                "name": p[-1].replace("连续", "") if p[-1] else out["name"],
                "open": float(p[0]), "high": float(p[1]), "low": float(p[2]),
                "last": float(p[3]), "volume": float(p[4] or 0),
                "oi": float(p[6] or 0),
                "prev": (float(p[14] or 0) if len(p) > 14 and _num(p[14]) else 0.0)
                        or (float(p[48]) if len(p) > 48 and _num(p[48]) else 0.0),
                "date": dstr, "time": tstr,
            })
        else:                                       # 商品期货格式
            out.update({
                "name": p[0].replace("连续", ""),
                "last": float(p[8]), "open": float(p[2]),
                "high": float(p[3]), "low": float(p[4]),
                "prev": float(p[10] or 0), "oi": float(p[13] or 0),
                "volume": float(p[14] or 0),
                "time": _fmt_time(p[1]), "date": p[17] if len(p) > 17 else "",
            })
        last, prev = out.get("last", 0), out.get("prev", 0)
        if prev > 0 and last > 0:
            out["change"] = last - prev
            out["pct"] = (last - prev) / prev * 100.0
        else:
            out["change"], out["pct"] = 0.0, 0.0
        return out
    except Exception as e:
        out["error"] = str(e)
        return out


def _num(s):
    try:
        float(s)
        return True
    except Exception:
        return False


def _fmt_time(s):
    s = str(s).zfill(6)
    return "%s:%s:%s" % (s[0:2], s[2:4], s[4:6])
