#!/usr/bin/env python3
"""最小 WebDAV 模拟服务（仅本地测试用）：PROPFIND/GET/PUT/MKCOL + Basic Auth"""
import http.server, base64, os

USER, PASS = 'test@qq.com', 'apppass123'
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, 'webdav_root')
os.makedirs(ROOT, exist_ok=True)

class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass

    def auth(self):
        h = self.headers.get('Authorization') or ''
        try:
            u, p = base64.b64decode(h.split(' ', 1)[1]).decode('utf-8').split(':', 1)
            return u == USER and p == PASS
        except Exception:
            return False

    def path_rel(self):
        p = self.path.split('?')[0].rstrip('/')
        rel = p[len('/dav/'):] if p.startswith('/dav/') else ''
        if not rel:
            return ROOT
        return os.path.join(ROOT, *rel.split('/'))

    def send(self, code, body=b'', ctype='text/plain'):
        self.send_response(code)
        self.send_header('Content-Type', ctype)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        if body:
            self.wfile.write(body)

    def do_PROPFIND(self):
        if not self.auth(): return self.send(401)
        self.send(207, b'<multistatus/>', 'application/xml')

    def do_GET(self):
        if not self.auth(): return self.send(401)
        fp = self.path_rel()
        if os.path.isfile(fp):
            self.send(200, open(fp, 'rb').read(), 'application/json')
        else:
            self.send(404)

    def do_PUT(self):
        if not self.auth(): return self.send(401)
        fp = self.path_rel()
        parent = os.path.dirname(fp)
        if not os.path.isdir(parent): return self.send(409)
        n = int(self.headers.get('Content-Length') or 0)
        open(fp, 'wb').write(self.rfile.read(n))
        self.send(201)

    def do_MKCOL(self):
        if not self.auth(): return self.send(401)
        os.makedirs(self.path_rel(), exist_ok=True)
        self.send(201)

http.server.ThreadingHTTPServer(('127.0.0.1', 8766), H).serve_forever()
