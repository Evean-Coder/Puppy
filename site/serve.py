"""本地预览服务器（支持 Range，视频才能拖动进度条）。

用法：
    python serve.py          # 默认 127.0.0.1:8123
    python serve.py 8000

Python 自带的 `python -m http.server` 不支持 Range 请求，浏览器拿不到 206，
所以 <video> 无法跳转——进度条点了也不会动。
"""

import os
import re
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.abspath(__file__))


class RangeHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def send_head(self):
        self._left = None
        rng = self.headers.get("Range")
        path = self.translate_path(self.path)
        if not rng or os.path.isdir(path) or not rng.startswith("bytes="):
            return super().send_head()

        m = re.match(r"bytes=(\d*)-(\d*)$", rng.replace(" ", ""))
        if not m:
            return super().send_head()

        try:
            f = open(path, "rb")
        except OSError:
            self.send_error(404)
            return None

        size = os.fstat(f.fileno()).st_size
        a, b = m.group(1), m.group(2)
        if a == "":
            if b == "":
                f.close()
                self.send_error(416)
                return None
            length = min(int(b), size)
            start, end = size - length, size - 1
        else:
            start = int(a)
            end = int(b) if b else size - 1
        end = min(end, size - 1)

        if start > end or start >= size:
            f.close()
            self.send_error(416)
            return None

        self.send_response(206)
        self.send_header("Content-Type", self.guess_type(path))
        self.send_header("Content-Range", "bytes %d-%d/%d" % (start, end, size))
        self.send_header("Content-Length", str(end - start + 1))
        self.send_header("Last-Modified", self.date_time_string(int(os.stat(path).st_mtime)))
        self.end_headers()
        f.seek(start)
        self._left = end - start + 1
        return f

    def copyfile(self, source, outputfile):
        left = getattr(self, "_left", None)
        if left is None:
            return super().copyfile(source, outputfile)
        try:
            while left > 0:
                chunk = source.read(min(262144, left))
                if not chunk:
                    break
                outputfile.write(chunk)
                left -= len(chunk)
        except (BrokenPipeError, ConnectionResetError):
            pass


def _port_busy(port):
    import socket
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        s.bind(("127.0.0.1", port))
        return False
    except OSError:
        return True
    finally:
        s.close()


if __name__ == "__main__":
    argv = [a for a in sys.argv[1:]]
    open_browser = "--no-open" not in argv
    ports = [int(a) for a in argv if a.isdigit()]
    start_port = ports[0] if ports else 8123

    srv = None
    port = start_port
    for p in [start_port] + list(range(start_port + 1, start_port + 10)):
        if _port_busy(p):
            print("port %d is busy, trying next…" % p, flush=True)
            continue
        try:
            srv = ThreadingHTTPServer(("127.0.0.1", p), RangeHandler)
            port = p
            break
        except OSError:
            continue

    if srv is None:
        print("no free port near %d; pass one explicitly: python serve.py 9000" % start_port)
        sys.exit(1)

    url = "http://127.0.0.1:%d/" % port
    print("serving %s at %s" % (ROOT, url), flush=True)
    print("按 Ctrl+C 停止。", flush=True)
    if open_browser:
        import threading
        import webbrowser
        threading.Timer(0.7, lambda: webbrowser.open(url)).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\nbye.")
    finally:
        srv.server_close()
