# -*- coding: utf-8 -*-
"""
加密工具（构建期专用，不随 EXE 发布）

作用：
  1) 把 datafeed / livefeed / server / app 编译成字节码并加密为 _enc/pkg.dat
  2) 把 web/ 目录下全部前端资源（html/css/js/字体）压缩加密为 _enc/web.pak

运行期由 launcher.py 解密：网页资源只在内存里存在，不落盘，
因此从 EXE 解包后既看不到 .py 源码，也看不到可读的 app.js / index.html。
"""
import marshal
import os
import shutil

MAGIC = b"FPAK"
MODULES = ("datafeed", "livefeed", "server", "app")
WEB_EXT = {".html", ".htm", ".css", ".js", ".json", ".svg", ".png",
           ".ico", ".woff2", ".woff", ".ttf", ".map"}

HERE = os.path.dirname(os.path.abspath(__file__))
ENC_DIR = os.path.join(HERE, "_enc")


# ---------------------------------------------------------------- 加密原语
def keystream(key, n):
    """SHA256 计数器模式生成密钥流"""
    import hashlib
    buf = bytearray()
    i = 0
    while len(buf) < n:
        buf += hashlib.sha256(key + i.to_bytes(8, "big")).digest()
        i += 1
    return bytes(buf[:n])


def xor_bytes(data, key):
    """大整数异或，比逐字节循环快两个数量级"""
    if not data:
        return data
    ks = keystream(key, len(data))
    return (int.from_bytes(data, "big") ^ int.from_bytes(ks, "big")).to_bytes(len(data), "big")


def seal(data, key):
    import zlib
    return xor_bytes(zlib.compress(data, 9), key)


def unseal(blob, key):
    import zlib
    return zlib.decompress(xor_bytes(blob, key))


# ---------------------------------------------------------------- 打包
def build_modules(out_path, key):
    """把源码编译成字节码（不含源码字符串）再整体加密"""
    mods = {}
    for name in MODULES:
        src = os.path.join(HERE, name + ".py")
        if not os.path.isfile(src):
            raise SystemExit("缺少源文件: " + src)
        with open(src, "r", encoding="utf-8") as f:
            text = f.read()
        code = compile(text, name + ".py", "exec")
        mods[name] = code          # 直接存 code 对象，外层 marshal 一并序列化
    blob = MAGIC + seal(marshal.dumps(mods), key)
    with open(out_path, "wb") as f:
        f.write(blob)
    return blob


def _stamp(html, ver):
    """给 html 里的本地 js/css 引用加上 ?v=版本号，
    这样升级后浏览器/WebView2 不会拿上一次的旧脚本。"""
    import re
    pat = re.compile(
        r'(?P<a>(?:src|href)\s*=\s*["\'])(?P<u>(?!https?:|//|data:|\?)[^"\':]+\.(?:js|css))(?P<b>["\'])',
        re.I)

    def rep(m):
        u = m.group("u")
        if "?" in u:
            return m.group(0)
        return m.group("a") + u + "?v=" + ver + m.group("b")

    return pat.sub(rep, html)


def build_web(out_path, key, web_dir=None, ver="1"):
    """打包 web/ 下所有前端资源"""
    web_dir = web_dir or os.path.join(HERE, "web")
    assets = {}
    total = 0
    for root, _dirs, files in os.walk(web_dir):
        for fn in files:
            ext = os.path.splitext(fn)[1].lower()
            if ext not in WEB_EXT:
                continue
            fp = os.path.join(root, fn)
            rel = os.path.relpath(fp, web_dir).replace(os.sep, "/")
            with open(fp, "rb") as f:
                data = f.read()
            if ext in (".html", ".htm"):
                data = _stamp(data.decode("utf-8"), ver).encode("utf-8")
            assets[rel] = data
            total += len(data)
    if "index.html" not in assets:
        raise SystemExit("web/index.html 不存在，无法打包")
    blob = MAGIC + seal(marshal.dumps(assets), key)
    with open(out_path, "wb") as f:
        f.write(blob)
    return assets, total, blob


# ---------------------------------------------------------------- 密钥
def new_key():
    return os.urandom(32)


def split_key(key):
    """把密钥拆成两段，运行期异或还原，避免明文常量直接搜到"""
    mask = os.urandom(32)
    a = bytes(x ^ y for x, y in zip(key, mask))
    return a, mask


# ---------------------------------------------------------------- 主流程
def prepare(ver="1"):
    """生成 _enc/pkg.dat 与 _enc/web.pak，返回 (密钥, 统计)"""
    key = new_key()
    if os.path.isdir(ENC_DIR):
        shutil.rmtree(ENC_DIR)
    os.makedirs(ENC_DIR, exist_ok=True)

    pkg = os.path.join(ENC_DIR, "pkg.dat")
    pak = os.path.join(ENC_DIR, "web.pak")

    mod_blob = build_modules(pkg, key)
    assets, raw_total, web_blob = build_web(pak, key, ver=ver)

    return key, {
        "mods": len(MODULES),
        "pkg_size": len(mod_blob),
        "assets": len(assets),
        "web_raw": raw_total,
        "web_size": len(web_blob),
    }


if __name__ == "__main__":
    k, st = prepare()
    print("模块 %d 个 -> pkg.dat %.1f KB" % (st["mods"], st["pkg_size"] / 1024))
    print("资源 %d 个 -> web.pak %.1f KB (原始 %.1f KB)"
          % (st["assets"], st["web_size"] / 1024, st["web_raw"] / 1024))
    print("自检：", end=" ")
    with open(os.path.join(ENC_DIR, "pkg.dat"), "rb") as f:
        blob = f.read()
    dec = unseal(blob[4:], k)
    mods = marshal.loads(dec)
    print("解密成功，模块", list(mods.keys()))
