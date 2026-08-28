#!/usr/bin/env python3
"""Personal Memory OS - Local Server with Image Proxy

Usage:
    python server.py

Then open http://localhost:8765 in your browser.
"""

import http.server
import urllib.request
import urllib.parse
import os
import sys
import socketserver
import time
import re
import json

PORT = 8765
DIRECTORY = os.path.dirname(os.path.abspath(__file__))

# In-memory image cache: {url: {type, data, ts}}
image_cache = {}

DOUBAN_CDN_NODES = [f'img{i}' for i in range(1, 10)]

def build_headers(target_url):
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9',
    }
    if 'doubanio.com' in target_url or 'douban.com' in target_url:
        headers['Referer'] = 'https://movie.douban.com/'
    return headers

def fetch_image(url):
    """Fetch image bytes from URL. Returns (content_type, data) or None."""
    try:
        req = urllib.request.Request(url, headers=build_headers(url))
        with urllib.request.urlopen(req, timeout=15) as response:
            content_type = response.headers.get('Content-Type', '')
            data = response.read()
            if content_type.startswith('image/') and len(data) > 500:
                return content_type, data
    except Exception:
        pass
    return None

def fetch_douban_image_with_fallback(url):
    """Fetch doubanio.com image, trying different CDN nodes on failure."""
    result = fetch_image(url)
    if result:
        return result

    # Try replacing CDN node
    match = re.match(r'(https?://)(img\d+)(\.doubanio\.com/.+)', url)
    if match:
        original_node = match.group(2)
        path = match.group(3)
        for node in DOUBAN_CDN_NODES:
            if node == original_node:
                continue
            alt_url = f'{match.group(1)}{node}{path}'
            result = fetch_image(alt_url)
            if result:
                return result
    return None

class MemoryOSHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET')
        super().end_headers()

    def do_GET(self):
        if self.path.startswith('/img?url='):
            self.handle_image_proxy()
        elif self.path.startswith('/api/douban'):
            self.handle_douban()
        elif self.path.startswith('/api/search?q='):
            self.handle_douban_search()
        else:
            super().do_GET()

    def handle_douban_search(self):
        parsed = urllib.parse.urlparse(self.path)
        params = urllib.parse.parse_qs(parsed.query)
        query = params.get('q', [''])[0]

        if not query:
            self.send_error(400, 'Missing query parameter')
            return

        douban_url = f'https://movie.douban.com/j/subject_suggest?q={urllib.parse.quote(query)}'
        try:
            req = urllib.request.Request(douban_url)
            req.add_header('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36')
            req.add_header('Referer', 'https://movie.douban.com/')
            req.add_header('Accept', 'application/json, text/javascript, */*; q=0.01')
            with urllib.request.urlopen(req, timeout=10) as response:
                data = response.read()
                self.send_response(200)
                self.send_header('Content-Type', 'application/json; charset=utf-8')
                self.send_header('Cache-Control', 'no-cache')
                self.end_headers()
                self.wfile.write(data)
        except Exception:
            self.send_error(500, 'Douban search failed')

    def handle_douban(self):
        # 与线上 functions/api/douban.js 行为一致：电影/书籍走豆瓣 subject_suggest，归一化返回
        parsed = urllib.parse.urlparse(self.path)
        params = urllib.parse.parse_qs(parsed.query)
        q = params.get('q', [''])[0]
        dtype = params.get('type', ['movie'])[0]
        if not q:
            self._send_json({'results': [], 'items': []}, 400)
            return
        kind = 'book' if dtype == 'book' else 'movie'
        douban_url = f'https://{kind}.douban.com/j/subject_suggest?q={urllib.parse.quote(q)}'
        try:
            req = urllib.request.Request(douban_url)
            req.add_header('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36')
            req.add_header('Referer', 'https://movie.douban.com/')
            req.add_header('Accept', 'application/json, text/javascript, */*; q=0.01')
            with urllib.request.urlopen(req, timeout=10) as response:
                raw = json.loads(response.read().decode('utf-8', 'ignore'))
            if kind == 'book':
                items = [{'external_id': it.get('id'), 'title': it.get('title', ''), 'authors': it.get('author_name', ''),
                          'publisher': '', 'publishedDate': it.get('year', ''), 'cover': it.get('pic', ''),
                          'isbn': '', 'categories': [], 'description': '', 'pageCount': 0, 'provider': 'douban'} for it in raw]
                self._send_json({'items': items})
            else:
                results = [{'external_id': it.get('id'), 'title': it.get('title', ''), 'original_title': it.get('sub_title', ''),
                            'poster': it.get('img', ''), 'release_date': it.get('year', ''),
                            'director': '', 'genres': [], 'description': '', 'provider': 'douban'} for it in raw]
                self._send_json({'results': results})
        except Exception:
            self._send_json({'results': [], 'items': []}, 502)

    def _send_json(self, obj, status=200):
        data = json.dumps(obj, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Cache-Control', 'no-cache')
        self.end_headers()
        self.wfile.write(data)

    def handle_image_proxy(self):
        parsed = urllib.parse.urlparse(self.path)
        params = urllib.parse.parse_qs(parsed.query)
        target_url = params.get('url', [''])[0]

        if not target_url:
            self.send_error(400, 'Missing url parameter')
            return

        # Check cache first
        cached = image_cache.get(target_url)
        if cached and (time.time() - cached['ts'] < 3600):
            self.send_response(200)
            self.send_header('Content-Type', cached['type'])
            self.send_header('Cache-Control', 'public, max-age=86400')
            self.end_headers()
            self.wfile.write(cached['data'])
            return

        is_douban = 'doubanio.com' in target_url or 'douban.com' in target_url
        result = None

        if is_douban:
            result = fetch_douban_image_with_fallback(target_url)
        else:
            for attempt in range(3):
                result = fetch_image(target_url)
                if result:
                    break
                time.sleep(1)

        if result:
            content_type, data = result
            image_cache[target_url] = {'type': content_type, 'data': data, 'ts': time.time()}
            self.send_response(200)
            self.send_header('Content-Type', content_type)
            self.send_header('Cache-Control', 'public, max-age=86400')
            self.end_headers()
            self.wfile.write(data)
        else:
            self.send_error(404, 'Image not available')

    def log_message(self, format, *args):
        if args and ('502' in str(args[0]) or '500' in str(args[0])):
            super().log_message(format, *args)

class ThreadingHTTPServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True

if __name__ == '__main__':
    with ThreadingHTTPServer(('', PORT), MemoryOSHandler) as httpd:
        print(f'Personal Memory OS server running at http://localhost:{PORT}')
        print(f'Image proxy enabled: /img?url=<image_url>')
        print('Press Ctrl+C to stop')
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print('\nServer stopped.')
