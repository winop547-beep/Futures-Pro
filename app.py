# -*- coding: utf-8 -*-
"""
期货分析系统 —— 桌面启动器
1) 启动本地数据服务
2) 优先使用 WebView2 原生窗口；不可用时用 Edge/Chrome 的应用模式窗口
"""
import os
import subprocess
import sys
import time
import traceback

import server as srv

APP_VER = "1.5"
APP_TITLE = "期货分析系统 v1.5 · Futures Pro"


# ---------------------------------------------------------------- 日志
def log(msg):
    try:
        base = os.environ.get("LOCALAPPDATA") or os.path.expanduser("~")
        d = os.path.join(base, "FuturesPro")
        os.makedirs(d, exist_ok=True)
        with open(os.path.join(d, "app.log"), "a", encoding="utf-8") as f:
            f.write("[%s] %s\n" % (time.strftime("%Y-%m-%d %H:%M:%S"), msg))
    except Exception:
        pass
    try:
        if sys.stdout:
            print(msg, flush=True)
    except Exception:
        pass


def message_box(text, title="期货分析系统"):
    try:
        import ctypes
        ctypes.windll.user32.MessageBoxW(0, str(text), title, 0x40)
    except Exception:
        pass


# ---------------------------------------------------------------- 环境探测
def find_webview2():
    roots = [os.environ.get("ProgramFiles(x86)"), os.environ.get("ProgramFiles"),
             r"C:\Program Files (x86)", r"C:\Program Files"]
    for root in roots:
        if not root:
            continue
        base = os.path.join(root, "Microsoft", "EdgeWebView", "Application")
        if os.path.isdir(base):
            for name in os.listdir(base):
                exe = os.path.join(base, name, "msedgewebview2.exe")
                if os.path.isfile(exe):
                    return exe
    return None


def find_browser():
    cands = [
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
        os.path.expandvars(r"%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"),
    ]
    for p in cands:
        if os.path.isfile(p):
            return p
    try:
        import winreg
        for hive, key in ((winreg.HKEY_LOCAL_MACHINE,
                           r"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\msedge.exe"),
                          (winreg.HKEY_LOCAL_MACHINE,
                           r"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe")):
            try:
                with winreg.OpenKey(hive, key) as k:
                    p = winreg.QueryValue(k, None)
                    if p and os.path.isfile(p):
                        return p
            except Exception:
                pass
    except Exception:
        pass
    return None


# ---------------------------------------------------------------- 窗口
def run_webview2(url):
    import webview
    win = webview.create_window(
        APP_TITLE, url,
        width=1560, height=960, min_size=(1100, 680),
        background_color="#0a0d13", confirm_close=False,
    )
    try:
        webview.start(gui="edgechromium", debug=False, private_mode=False,
                      storage_path=os.path.join(os.environ.get("LOCALAPPDATA", "."),
                                                "FuturesPro", "wv2"))
    finally:
        return getattr(win, "url", url)


def app_window_state():
    """返回 (是否存在窗口对象, 是否已显示为正常尺寸的可见窗口)。

    浏览器冷启动时会先建一个 0×0 的隐藏窗口，过十几秒才真正显示，
    这两种情况要区别对待：前者说明正在启动，后者才算真的能看见。"""
    try:
        import ctypes
        from ctypes import wintypes
        u = ctypes.windll.user32
        obj, vis = [], []
        CB = ctypes.WINFUNCTYPE(ctypes.c_bool, wintypes.HWND, wintypes.LPARAM)

        def cb(h, _l):
            n = u.GetWindowTextLengthW(h)
            if not n:
                return True
            buf = ctypes.create_unicode_buffer(n + 1)
            u.GetWindowTextW(h, buf, n + 1)
            if "期货分析系统" not in buf.value:
                return True
            obj.append(h)
            r = wintypes.RECT()
            u.GetWindowRect(h, ctypes.byref(r))
            if u.IsWindowVisible(h) and (r.right - r.left) >= 200 and (r.bottom - r.top) >= 150:
                vis.append(h)
            return True

        u.EnumWindows(CB(cb), 0)
        return bool(obj), bool(vis)
    except Exception:
        return False, False


def rescue_window():
    """把被浏览器丢到屏幕外、或缩成一点的窗口拉回主屏。
    部分机器（多屏 / 高 DPI）上 Edge 会把 --app 窗口放到 -25984 之类的坐标，
    表现就是“程序在跑但看不到窗口”。"""
    try:
        import ctypes
        from ctypes import wintypes
        u = ctypes.windll.user32
        sw = u.GetSystemMetrics(0)          # 主屏宽
        sh = u.GetSystemMetrics(1)          # 主屏高
        target = []
        CB = ctypes.WINFUNCTYPE(ctypes.c_bool, wintypes.HWND, wintypes.LPARAM)

        def cb(h, _l):
            n = u.GetWindowTextLengthW(h)
            if not n:
                return True
            buf = ctypes.create_unicode_buffer(n + 1)
            u.GetWindowTextW(h, buf, n + 1)
            if "期货分析系统" not in buf.value:
                return True
            r = wintypes.RECT()
            u.GetWindowRect(h, ctypes.byref(r))
            w, hh = r.right - r.left, r.bottom - r.top
            off = r.right < 0 or r.bottom < 0 or r.left > sw or r.top > sh
            if (not u.IsWindowVisible(h)) or w < 200 or hh < 150 or off:
                target.append(h)
            return True

        u.EnumWindows(CB(cb), 0)
        for h in target:
            u.ShowWindow(h, 9)              # SW_RESTORE
            u.MoveWindow(h, 80, 60, max(1100, min(1560, sw - 120)),
                         max(680, min(960, sh - 140)), True)
            u.SetForegroundWindow(h)
        return bool(target)
    except Exception:
        return False


def enum_app_windows():
    """标题里带程序名的所有顶层窗口句柄"""
    out = []
    try:
        import ctypes
        from ctypes import wintypes
        u = ctypes.windll.user32
        CB = ctypes.WINFUNCTYPE(ctypes.c_bool, wintypes.HWND, wintypes.LPARAM)

        def cb(h, _l):
            n = u.GetWindowTextLengthW(h)
            if not n:
                return True
            buf = ctypes.create_unicode_buffer(n + 1)
            u.GetWindowTextW(h, buf, n + 1)
            if "期货分析系统" in buf.value:
                out.append(h)
            return True

        u.EnumWindows(CB(cb), 0)
    except Exception:
        return []
    return out


_ICON_CACHE = {}


def _icon_handles():
    """加载程序自带 ico，返回 (大图标, 小图标) 句柄"""
    if "h" in _ICON_CACHE:
        return _ICON_CACHE["h"]
    big = small = None
    try:
        import ctypes
        from ctypes import wintypes
        u = ctypes.windll.user32
        base = getattr(sys, "_MEIPASS", os.path.dirname(os.path.abspath(__file__)))
        ico = os.path.join(base, "app.ico")
        if not os.path.isfile(ico):
            ico = os.path.join(os.path.dirname(os.path.abspath(__file__)), "app.ico")
        if os.path.isfile(ico):
            u.LoadImageW.restype = wintypes.HANDLE
            u.LoadImageW.argtypes = [wintypes.HINSTANCE, wintypes.LPCWSTR, wintypes.UINT,
                                     ctypes.c_int, ctypes.c_int, wintypes.UINT]
            LR_LOADFROMFILE, IMAGE_ICON = 0x00000010, 1
            big = u.LoadImageW(None, ico, IMAGE_ICON, u.GetSystemMetrics(11),
                               u.GetSystemMetrics(12), LR_LOADFROMFILE)
            small = u.LoadImageW(None, ico, IMAGE_ICON, u.GetSystemMetrics(49),
                                 u.GetSystemMetrics(50), LR_LOADFROMFILE)
    except Exception:
        big = small = None
    _ICON_CACHE["h"] = (big, small)
    return big, small


def set_app_icon():
    """把窗口图标、任务栏图标、Alt+Tab 图标换成程序自己的。

    浏览器应用模式默认沿用 Edge 的图标，任务栏上挂着蓝色的 e，
    别人一眼就看出这是网页，所以窗口一出来就替换掉。"""
    big, small = _icon_handles()
    if not big and not small:
        return False
    try:
        import ctypes
        from ctypes import wintypes
        u = ctypes.windll.user32
        u.SendMessageW.argtypes = [wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM]
        u.SendMessageW.restype = ctypes.c_void_p
        set_cls = getattr(u, "SetClassLongPtrW", None) or u.SetClassLongW
        set_cls.restype = ctypes.c_void_p
        set_cls.argtypes = [wintypes.HWND, ctypes.c_int, ctypes.c_void_p]
        WM_SETICON, GCLP_HICON, GCLP_HICONSM = 0x0080, -14, -34

        done = False
        for h in enum_app_windows():
            if big:
                u.SendMessageW(h, WM_SETICON, 1, int(big))      # ICON_BIG
                set_cls(h, GCLP_HICON, int(big))                # 类图标：任务栏 / Alt+Tab
            if small:
                u.SendMessageW(h, WM_SETICON, 0, int(small))    # ICON_SMALL
                set_cls(h, GCLP_HICONSM, int(small))
            done = True
        return done
    except Exception:
        return False


def run_browser(url):
    exe = find_browser()
    if not exe:
        log("未找到 Edge/Chrome，使用系统默认浏览器")
        os.startfile(url)          # noqa: 打开默认浏览器
        return

    profile = os.path.join(os.environ.get("LOCALAPPDATA", os.path.expanduser("~")),
                           "FuturesPro", "app-window")
    args = [
        exe,
        "--app=" + url,
        "--window-size=1560,960",
        "--user-data-dir=" + profile,
        "--no-first-run",
        "--no-default-browser-check",
        "--no-service-autorun",
        "--disable-features=Translate,TranslateUI,MediaRouter,msEdgeTranslate",
        "--disable-pinch",
        "--overscroll-history-navigation=0",
        "--default-background-color=0a0d13ff",
    ]
    log("启动应用窗口: " + exe)
    try:
        proc = subprocess.Popen(args, close_fds=True)
    except Exception as e:
        log("启动失败，改用默认浏览器: %s" % e)
        os.startfile(url)
        return

    # 浏览器进程可能很快退出（交给已有实例），因此以页面心跳判断窗口是否还开着
    t0 = time.time()
    gone_since = None
    fallback_at = None
    rescue_tried = False
    icon_at = 0.0
    icon_ok = False
    while True:
        if proc.poll() is not None and gone_since is None:
            gone_since = time.time()
            log("浏览器启动器已退出，等待页面心跳")
        now = time.time()
        if srv.STATE.get("bye"):
            log("页面已关闭")
            break

        # 统一外观：窗口一出现就把浏览器图标换成程序图标，
        # 否则任务栏、标题栏挂的都是 Edge 的图标，一眼就看出是网页。
        if now - icon_at > (60 if icon_ok else 3):
            icon_at = now
            if set_app_icon() and not icon_ok:
                icon_ok = True
                log("已替换窗口图标")

        # 与心跳无关的兜底：保证屏幕上一定能看到界面
        if fallback_at is None and now - t0 > 18:
            obj, vis = app_window_state()
            if vis:
                fallback_at = now
                log("应用窗口已显示")
            elif obj and not rescue_tried:
                rescue_tried = True
                if rescue_window():
                    log("窗口位置异常，已拉回屏幕")
            elif now - t0 > 34:
                log("应用窗口未显示，改用默认浏览器打开")
                fallback_at = now
                try:
                    os.startfile(url)          # noqa: 打开默认浏览器
                except Exception as e:
                    log("兜底打开失败: %s" % e)

        last_hb = srv.STATE.get("last_hb", t0)
        if last_hb > t0:
            # 页面已连上：心跳超时即视为窗口关闭（后台标签页最长 1 分钟一次心跳）
            if now - last_hb > 80:
                log("心跳超时，退出")
                break
        else:
            # 页面从未连上：最多等 120 秒
            if now - t0 > 120:
                log("页面未连接，退出")
                break
        time.sleep(2)


# ---------------------------------------------------------------- main
def main():
    server_only = "--server-only" in sys.argv
    s = srv.Server().start()
    log("服务已启动: " + s.url)
    if server_only:
        print(s.url, flush=True)
        try:
            while True:
                time.sleep(3600)
        except KeyboardInterrupt:
            pass
        finally:
            s.stop()
        return

    # 带版本参数：升级后 URL 变化，避免 WebView2 沿用上一次的旧页面缓存
    url = s.url + "?v=" + APP_VER
    try:
        if find_webview2() and os.environ.get("FUTURES_FORCE_BROWSER") != "1":
            log("使用 WebView2 原生窗口")
            run_webview2(url)
        else:
            log("未检测到 WebView2 运行时，使用浏览器应用模式")
            run_browser(url)
    except Exception:
        log("窗口异常:\n" + traceback.format_exc())
        try:
            run_browser(url)
        except Exception:
            log("回退失败:\n" + traceback.format_exc())
            message_box("程序启动失败，详情见日志：\n"
                        + os.path.join(os.environ.get("LOCALAPPDATA", ""), "FuturesPro", "app.log"))
    finally:
        s.stop()
        log("已退出")


if __name__ == "__main__":
    main()
