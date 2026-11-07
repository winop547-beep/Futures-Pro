# -*- coding: utf-8 -*-
"""一键加密打包为单文件 EXE： python build.py"""
import marshal
import os
import shutil
import subprocess
import sys

import seal

HERE = os.path.dirname(os.path.abspath(__file__))
NAME = "FuturesPro"
OUT_CN = "期货分析系统.exe"
VER = (1, 5, 0, 0)
VER_STR = "1.5.0.0"

# 加密后模块由 launcher 动态装载，PyInstaller 静态分析看不到它们，
# 因此这里显式声明运行期会用到的标准库与第三方模块。
HIDDEN = [
    "urllib.request", "urllib.parse", "urllib.error",
    "http.server", "socketserver", "http.client",
    "ssl", "email", "email.parser", "email.message", "email.utils",
    "socket", "json", "html", "math", "posixpath", "subprocess",
    "traceback", "winreg", "ctypes", "ctypes.wintypes",
    "datetime", "threading", "time", "re", "os", "sys",
    "base64", "hashlib", "zlib", "marshal", "types", "builtins",
    "collections", "queue", "mimetypes", "tempfile", "uuid",
    "calendar", "io", "codecs", "struct", "binascii", "enum",
    "functools", "itertools", "contextlib", "warnings", "unicodedata",
    "webview", "webview.platforms.edgechromium", "clr", "clr_loader",
]


def pyinstaller_args(entry):
    args = [
        sys.executable, "-m", "PyInstaller",
        "--noconfirm", "--clean", "--onefile", "--windowed",
        "--name", NAME,
        "--icon", os.path.join(HERE, "app.ico"),
        "--version-file", os.path.join(HERE, "version_info.txt"),
        "--add-data", os.path.join(HERE, "_enc") + os.pathsep + "_enc",
        "--add-data", os.path.join(HERE, "app.ico") + os.pathsep + ".",
        "--collect-submodules", "webview",
        "--collect-submodules", "clr_loader",
        "--exclude-module", "tkinter",
        "--exclude-module", "numpy",
        "--exclude-module", "PIL",
    ]
    # 加密启动器里有一句 import app（仅供源码调试），必须排除，
    # 否则 PyInstaller 会把业务模块重新以明文 .pyc 打进 EXE，加密就白做了。
    for m in seal.MODULES:
        args += ["--exclude-module", m]
    for h in HIDDEN:
        args += ["--hidden-import", h]
    args.append(entry)
    return args


VERSION_TEMPLATE = """VSVersionInfo(
  ffi=FixedFileInfo(
    filevers=%(ver)s,
    prodvers=%(ver)s,
    mask=0x3f, flags=0x0, OS=0x40004, fileType=0x1, subtype=0x0,
    date=(0, 0)
  ),
  kids=[
    StringFileInfo([
      StringTable('080404B0', [
        StringStruct('CompanyName', 'Futures Pro'),
        StringStruct('FileDescription', '期货分析系统 v1.5'),
        StringStruct('FileVersion', '%(vs)s'),
        StringStruct('InternalName', 'FuturesPro'),
        StringStruct('LegalCopyright', '仅供行情分析与技术指标学习使用'),
        StringStruct('OriginalFilename', '期货分析系统.exe'),
        StringStruct('ProductName', '期货分析系统 · Futures Pro'),
        StringStruct('ProductVersion', '%(vs)s')
      ])
    ]),
    VarFileInfo([VarStruct('Translation', [2052, 1200])])
  ]
)
"""


def write_version_file():
    """生成 EXE 版本信息资源（右键属性可见版本号）"""
    path = os.path.join(HERE, "version_info.txt")
    body = VERSION_TEMPLATE % {"ver": str(VER), "vs": VER_STR}
    with open(path, "w", encoding="utf-8") as f:
        f.write(body)
    return path


def make_entry(key):
    """把本次随机密钥注入启动器，生成 PyInstaller 入口文件"""
    k1, k2 = seal.split_key(key)
    src_path = os.path.join(HERE, "launcher.py")
    with open(src_path, "r", encoding="utf-8") as f:
        src = f.read()
    if '"__KEY1__"' not in src or '"__KEY2__"' not in src:
        raise SystemExit("launcher.py 缺少密钥占位符")
    src = src.replace('"__KEY1__"', repr(k1.hex())).replace('"__KEY2__"', repr(k2.hex()))
    entry = os.path.join(HERE, "_build_entry.py")
    with open(entry, "w", encoding="utf-8") as f:
        f.write(src)
    return entry


def verify_encrypted(pkg_path, key):
    """打包前自检：头部合法、能解回字节码、且不含长串明文源码特征"""
    with open(pkg_path, "rb") as f:
        raw = f.read()
    if raw[:4] != seal.MAGIC:
        raise SystemExit("自检失败：pkg.dat 头部异常")
    mods = marshal.loads(seal.unseal(raw[4:], key))
    missing = [m for m in seal.MODULES if m not in mods]
    if missing:
        raise SystemExit("自检失败：缺少模块 %s" % missing)
    for probe in (b"import urllib.request", b"def get_bars", b"ThreadingHTTPServer",
                  b"function renderChart", b"class Handler"):
        if probe in raw:
            raise SystemExit("自检失败：pkg.dat 含明文 %r" % probe)
    return True


def kill_running():
    """结束正在运行的旧版本，避免 dist 里的 EXE 被占用"""
    for name in (OUT_CN, NAME + ".exe", NAME):
        try:
            subprocess.run(["taskkill", "/F", "/IM", name],
                           capture_output=True, timeout=8)
        except Exception:
            pass


def main():
    os.chdir(HERE)
    kill_running()

    print("[1/4] 加密源码与前端资源…")
    key, st = seal.prepare(VER_STR)
    print("      pkg.dat %.1f KB（%d 个模块，仅字节码）" % (st["pkg_size"] / 1024, st["mods"]))
    print("      web.pak %.1f KB（%d 个资源，原始 %.1f KB）"
          % (st["web_size"] / 1024, st["assets"], st["web_raw"] / 1024))
    verify_encrypted(os.path.join(HERE, "_enc", "pkg.dat"), key)

    print("[2/4] 生成版本资源与加密入口…")
    write_version_file()
    entry = make_entry(key)

    print("[3/4] PyInstaller 打包中（约 1~2 分钟）…")
    r = subprocess.run(pyinstaller_args(entry))
    try:
        os.remove(entry)
    except OSError:
        pass
    if r.returncode != 0:
        print("打包失败")
        return 1

    exe = os.path.join(HERE, "dist", NAME + ".exe")
    if not os.path.isfile(exe):
        print("未找到产物")
        return 1

    print("[4/4] 输出成品…")
    target = os.path.join(HERE, "dist", OUT_CN)
    shutil.copyfile(exe, target)
    try:
        os.remove(exe)
    except OSError:
        pass
    size = os.path.getsize(target) / 1024 / 1024
    print("完成: %s  (%.1f MB)" % (target, size))
    return 0


if __name__ == "__main__":
    sys.exit(main())
