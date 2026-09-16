"""禁用缓存的静态服务器：每次请求都回源，保证改代码后刷新即生效。"""
import http.server
import socketserver
import functools
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
DIRECTORY = sys.argv[2] if len(sys.argv) > 2 else r"D:\code\Agame\web"


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()


class ThreadedServer(socketserver.ThreadingMixIn, socketserver.TCPServer):
    allow_reuse_address = True
    daemon_threads = True


if __name__ == "__main__":
    with ThreadedServer(("127.0.0.1", PORT), NoCacheHandler) as httpd:
        print(f"serving {DIRECTORY} at http://127.0.0.1:{PORT}/ (no-cache)")
        httpd.serve_forever()
