# -*- coding: utf-8 -*-
"""
期货分析系统 —— 加密启动器（EXE 唯一入口）

职责：
  1) 校验并解密 _enc/pkg.dat（业务模块字节码），在内存中装载执行
  2) 解密 _enc/web.pak（前端资源），交给内置服务从内存分发，不写磁盘
  3) 调用真正的 app.main() 打开窗口

说明：程序内不含明文源码，也不含可被反编译的 .pyc；
      网页资源（含指标算法 app.js）只存在于进程内存。
"""
import builtins
import hashlib
import marshal
import os
import sys
import traceback
import zlib

# 由 build.py 在打包时注入（十六进制，拆分存放）
_K1H = "__KEY1__"
_K2H = "__KEY2__"

MAGIC = b"FPAK"
MODULES = ("datafeed", "livefeed", "server", "app")


# ---------------------------------------------------------------- 解密
def _key():
    """未注入密钥（源码调试状态）时返回 None"""
    if _K1H.startswith("__") or _K2H.startswith("__"):
        return None
    try:
        a = bytes.fromhex(_K1H)
        b = bytes.fromhex(_K2H)
    except ValueError:
        return None
    if len(a) != len(b) or not a:
        return None
    return bytes(x ^ y for x, y in zip(a, b))


def _crypt(data):
    if not data:
        return data
    key = _key()
    if key is None:
        raise ValueError("密钥缺失")
    buf = bytearray()
    i = 0
    while len(buf) < len(data):
        buf += hashlib.sha256(key + i.to_bytes(8, "big")).digest()
        i += 1
    ks = bytes(buf[:len(data)])
    return (int.from_bytes(data, "big") ^ int.from_bytes(ks, "big")).to_bytes(len(data), "big")


def _read_blob(path):
    with open(path, "rb") as f:
        raw = f.read()
    if raw[:4] != MAGIC:
        raise ValueError("程序资源已损坏或被修改：" + os.path.basename(path))
    return zlib.decompress(_crypt(raw[4:]))


def base_dir():
    if getattr(sys, "frozen", False):
        return getattr(sys, "_MEIPASS",
                       os.path.dirname(os.path.abspath(sys.executable)))
    return os.path.dirname(os.path.abspath(__file__))


def load_module(name, code):
    if isinstance(code, (bytes, bytearray)):   # 兼容旧的打包方式
        code = marshal.loads(code)
    mod = type(sys)(name)
    mod.__file__ = name + ".py"
    mod.__builtins__ = builtins
    sys.modules[name] = mod
    exec(code, mod.__dict__)
    return mod


# ---------------------------------------------------------------- 引导
def boot():
    base = base_dir()
    enc = os.path.join(base, "_enc")
    pkg_path = os.path.join(enc, "pkg.dat")
    pak_path = os.path.join(enc, "web.pak")

    # 源码调试模式：密钥未注入，或没有加密包 —— 直接按普通模块导入
    if _key() is None or not os.path.isfile(pkg_path):
        if base not in sys.path:
            sys.path.insert(0, base)
        import app
        return app.main()

    mods = marshal.loads(_read_blob(pkg_path))
    assets = marshal.loads(_read_blob(pak_path)) if os.path.isfile(pak_path) else None

    for name in MODULES:
        code = mods.get(name)
        if code is None:
            raise ValueError("缺少模块：" + name)
        load_module(name, code)

    if assets:
        # 前端资源驻留内存，服务直接从字典分发，不落地
        sys.modules["server"].WEB_ASSETS = assets

    return sys.modules["app"].main()


def main():
    try:
        return boot()
    except Exception:
        detail = traceback.format_exc()
        log_path = ""
        try:
            base = os.environ.get("LOCALAPPDATA") or os.path.expanduser("~")
            d = os.path.join(base, "FuturesPro")
            os.makedirs(d, exist_ok=True)
            log_path = os.path.join(d, "app.log")
            with open(log_path, "a", encoding="utf-8") as f:
                f.write(detail + "\n")
        except Exception:
            pass
        if "--server-only" not in sys.argv:
            try:
                import ctypes
                ctypes.windll.user32.MessageBoxW(
                    0,
                    "程序启动失败。\n\n"
                    "请把本文件复制到电脑里再双击运行（不要直接在压缩包或网络盘里打开）。\n"
                    "如果仍然失败，请把下面的日志文件发给提供者：\n" + (log_path or "（日志不可写）"),
                    "期货分析系统", 0x10)
            except Exception:
                pass
        return 1


if __name__ == "__main__":
    sys.exit(main())
