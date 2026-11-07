# -*- coding: utf-8 -*-
"""内置 HTTP 服务：提供静态页面 + 行情 API"""
import json
import os
import posixpath
import sys
import threading
import time
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs, unquote

import datafeed
import livefeed

STATE = {"last_hit": time.time(), "last_hb": time.time(), "hits": 0, "bye": False}


def resource_dir():
    if getattr(sys, "frozen", False):
        return getattr(sys, "_MEIPASS", os.path.dirname(os.path.abspath(sys.executable)))
    return os.path.dirname(os.path.abspath(__file__))


WEB_DIR = os.path.join(resource_dir(), "web")

# 打包模式：加密启动器会把解密后的前端资源注入到这里（路径 -> 字节），
# 服务直接从内存分发，磁盘上不会留下任何网页源码。开发模式保持 None 走文件。
WEB_ASSETS = None

MIME = {
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".ico": "image/x-icon",
    ".woff2": "font/woff2",
}


class Handler(BaseHTTPRequestHandler):
    server_version = "FuturesPro/1.5"
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        pass

    # -------------------------------------------------- helpers
    def _send(self, code, body, ctype="application/json; charset=utf-8", cache=False):
        if isinstance(body, (dict, list)):
            body = json.dumps(body, ensure_ascii=False)
        raw = body.encode("utf-8") if isinstance(body, str) else body
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Cache-Control", "public, max-age=3600" if cache else "no-store")
        self.end_headers()
        try:
            self.wfile.write(raw)
        except Exception:
            pass

    def _err(self, msg, code=500):
        self._send(code, {"ok": False, "error": str(msg)})

    # -------------------------------------------------- routes
    def do_GET(self):
        STATE["last_hit"] = time.time()
        STATE["hits"] = STATE.get("hits", 0) + 1
        u = urlparse(self.path)
        path = unquote(u.path)
        qs = parse_qs(u.query)

        try:
            if path == "/api/catalog":
                return self._send(200, {
                    "ok": True,
                    "groups": [{"name": g, "items": [{"code": c, "name": n} for c, n in items]}
                               for g, items in datafeed.CATALOG],
                })

            if path == "/api/kline":
                code = (qs.get("code") or ["RB0"])[0]
                tf = (qs.get("tf") or ["1d"])[0]
                force = (qs.get("force") or ["0"])[0] == "1"
                bars, meta = datafeed.get_bars(code, tf, force=force)
                return self._send(200, {"ok": True, "meta": meta, "bars": bars})

            if path == "/api/quote":
                code = (qs.get("code") or ["RB0"])[0]
                return self._send(200, {"ok": True, "quote": datafeed.get_quote(code)})

            if path == "/api/live":
                ch = (qs.get("ch") or ["cn"])[0]
                limit = int((qs.get("limit") or ["48"])[0])
                return self._send(200, livefeed.get_live(ch, max(5, min(120, limit))))

            if path == "/api/market":
                force = (qs.get("force") or ["0"])[0] == "1"
                return self._send(200, livefeed.get_market(force=force))

            if path == "/api/ping":
                return self._send(200, {"ok": True, "app": "futures-pro"})

            if path == "/api/hb":
                STATE["last_hb"] = time.time()
                return self._send(200, {"ok": True})

            if path == "/api/bye":
                STATE["bye"] = True
                return self._send(200, {"ok": True})

            # 静态资源
            rel = "index.html" if path in ("/", "") else path.lstrip("/")
            rel = posixpath.normpath(rel).replace("\\", "/")
            if rel.startswith(".."):
                return self._err("非法路径", 403)

            if WEB_ASSETS is not None:
                data = WEB_ASSETS.get(rel)
                if data is None:
                    return self._err("未找到资源: " + rel, 404)
                ctype = MIME.get(posixpath.splitext(rel)[1].lower(),
                                 "application/octet-stream")
                # 不缓存：否则升级版本后 WebView2 仍会显示上一次的旧页面
                return self._send(200, data, ctype, cache=False)

            fp = os.path.join(WEB_DIR, rel.replace("/", os.sep))
            if not os.path.isfile(fp):
                return self._err("未找到资源: " + rel, 404)
            ctype = MIME.get(os.path.splitext(fp)[1].lower(), "application/octet-stream")
            with open(fp, "rb") as f:
                data = f.read()
            return self._send(200, data, ctype, cache=False)

        except BrokenPipeError:
            pass
        except Exception as e:
            return self._err(e)


# 固定端口：让 localStorage（指标参数、画线记录）在每次启动时都能延续
PREFERRED_PORTS = (50573, 50574, 50575, 50576, 50577)


class Server:
    def __init__(self, host="127.0.0.1", port=None):
        self.httpd = None
        for p in (PREFERRED_PORTS if port is None else (port,)):
            try:
                self.httpd = ThreadingHTTPServer((host, p), Handler)
                break
            except OSError:
                self.httpd = None
        if self.httpd is None:
            self.httpd = ThreadingHTTPServer((host, 0), Handler)
        self.httpd.daemon_threads = True
        self.port = self.httpd.server_address[1]
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)

    @property
    def url(self):
        return "http://127.0.0.1:%d/" % self.port

    def start(self):
        self.thread.start()
        return self

    def stop(self):
        try:
            self.httpd.shutdown()
        except Exception:
            pass
