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
        elif self.path.startswith('/api/sports'):
            self.handle_sports()
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
        # 与线上 functions/api/douban.js 行为一致：
        #   1) 搜索模式 type=movie|book&q= —— 豆瓣 subject_suggest 归一化返回
        #   2) 详情模式 type=detail&kind=movie|book&id= —— 电影走 m.douban rexxar API（含简介/导演/评分/片长），
        #      书籍走详情页 HTML 解析（出版社/ISBN/页数/出版年/简介）
        parsed = urllib.parse.urlparse(self.path)
        params = urllib.parse.parse_qs(parsed.query)
        q = params.get('q', [''])[0]
        dtype = params.get('type', ['movie'])[0]
        did = params.get('id', [''])[0]

        if dtype == 'detail':
            kind = params.get('kind', ['movie'])[0]
            if not did:
                self._send_json({'detail': None}, 400)
                return
            try:
                detail = self._douban_book_detail(did) if kind == 'book' else self._douban_movie_detail(did)
                self._send_json({'detail': detail})
            except Exception:
                self._send_json({'detail': None}, 502)
            return

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

    def _fetch_url(self, url, referer='https://movie.douban.com/', timeout=12):
        req = urllib.request.Request(url)
        req.add_header('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36')
        req.add_header('Referer', referer)
        req.add_header('Accept', 'application/json, text/javascript, */*; q=0.01')
        req.add_header('Accept-Language', 'zh-CN,zh;q=0.9')
        with urllib.request.urlopen(req, timeout=timeout) as response:
            return response.read().decode('utf-8', 'ignore')

    def _douban_movie_detail(self, did):
        # 豆瓣移动端 rexxar API：含 intro 简介 / 导演 / 类型 / 评分 / 片长
        body = self._fetch_url(f'https://m.douban.com/rexxar/api/v2/movie/{did}',
                               referer=f'https://m.douban.com/movie/{did}/')
        d = json.loads(body)
        durations = d.get('durations') or ['']
        dm = re.search(r'\d+', durations[0] or '')
        pubdate = (d.get('pubdate') or [''])[0] if d.get('pubdate') else ''
        return {
            'external_id': str(d.get('id') or did),
            'title': d.get('title') or '',
            'original_title': d.get('original_title') or '',
            'poster': d.get('cover_url') or ((d.get('pic') or {}).get('large') or ''),
            'release_date': pubdate or (str(d.get('year')) if d.get('year') else ''),
            'director': ' / '.join(x.get('name', '') for x in (d.get('directors') or [])),
            'actors': ' / '.join(x.get('name', '') for x in (d.get('actors') or [])),
            'genres': d.get('genres') or [],
            'description': d.get('intro') or '',
            'rating': ((d.get('rating') or {}).get('value') or None),
            'runtime': int(dm.group()) if dm else None,
            'subtitle': d.get('card_subtitle') or '',
        }

    def _douban_book_detail(self, did):
        # 书籍详情页 HTML 解析：出版社 / ISBN / 页数 / 出版年 / 简介 / 作者
        html = self._fetch_url(f'https://book.douban.com/subject/{did}/', referer='https://book.douban.com/')
        publisher = isbn = pages = pubdate = ''
        info_m = re.search(r'<div id="info">([\s\S]*?)</div>', html)
        if info_m:
            text = re.sub(r'<br\s*/?>', '\n', info_m.group(1))
            text = re.sub(r'<[^>]+>', '', text)
            def line(label):
                m = re.search(label + r'\s*[::]\s*([^\n]+)', text)
                return m.group(1).strip() if m else ''
            publisher = line('出版社')
            isbn = line('ISBN')
            pages = line('页数')
            pubdate = line('出版年')
        intro = ''
        intro_m = re.search(r'<div class="intro">([\s\S]*?)</div>', html)
        if intro_m:
            p_m = re.search(r'<p>([\s\S]*?)</p>', intro_m.group(1))
            if p_m:
                intro = re.sub(r'<[^>]+>', ' ', p_m.group(1))
                intro = re.sub(r'\s+', ' ', intro).strip()
        author = ''
        author_m = re.search(r'<span class="pl">\s*作者\s*[::]\s*</span>([\s\S]{0,400}?)<br', html)
        if author_m:
            author = re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', ' ', author_m.group(1))).strip()
        return {
            'external_id': str(did),
            'authors': author,
            'publisher': publisher,
            'isbn': isbn,
            'pageCount': int(pages) if pages and pages.isdigit() else 0,
            'publishedDate': pubdate,
            'description': intro,
        }

    def handle_sports(self):
        # 与线上 functions/api/sports.js 行为一致：TheSportsDB 代理（球队搜索 + 真实足球赛程）
        parsed = urllib.parse.urlparse(self.path)
        params = urllib.parse.parse_qs(parsed.query)
        stype = params.get('type', [''])[0]

        def tsb_fetch(path):
            url = f'https://www.thesportsdb.com/api/v1/json/3/{path}'
            req = urllib.request.Request(url)
            req.add_header('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36')
            req.add_header('Accept', 'application/json')
            with urllib.request.urlopen(req, timeout=15) as response:
                return json.loads(response.read().decode('utf-8', 'ignore'))

        league_map = {
            '4328': ('英超', 4), '4335': ('西甲', 4), '4331': ('德甲', 4), '4332': ('意甲', 4),
            '4334': ('法甲', 3), '4480': ('欧冠', 5), '4398': ('中超', 3),
        }

        def normalize_event(ev, lm):
            ts = None
            raw_ts = ev.get('strTimestamp') or ''
            if raw_ts:
                ts = raw_ts if (raw_ts.endswith('Z') or re.search(r'[+-]\d{2}:?\d{2}$', raw_ts)) else raw_ts + 'Z'
            hs, as_ = ev.get('intHomeScore'), ev.get('intAwayScore')
            has_score = (hs is not None and hs != '') or (as_ is not None and as_ != '')
            is_fin = has_score or re.search(r'FT|Finished|AET|PEN', str(ev.get('strStatus') or ''), re.I)
            rnd = f"第{ev.get('intRound')}轮" if ev.get('intRound') else (ev.get('strStatus') or '')
            return {
                'sport': 'football',
                'home_id': ev.get('idHomeTeam') or f"{ev.get('idEvent')}_h",
                'home_name': ev.get('strHomeTeam') or '',
                'away_id': ev.get('idAwayTeam') or f"{ev.get('idEvent')}_a",
                'away_name': ev.get('strAwayTeam') or '',
                'ts': ts,
                'date': ev.get('dateEvent') or '',
                'time': str(ev.get('strTime') or '')[:5],
                'league': lm[0] if lm else (ev.get('strLeague') or ''),
                'round': rnd,
                'status': 'finished' if is_fin else 'upcoming',
                'home_score': int(hs) if (hs is not None and str(hs) != '') else None,
                'away_score': int(as_) if (as_ is not None and str(as_) != '') else None,
                'importance': lm[1] if lm else 3,
                'tournament_weight': lm[1] if lm else 3,
            }

        try:
            if stype == 'teamsearch':
                q = params.get('q', [''])[0].strip()
                sport = params.get('sport', ['football'])[0]
                if not q:
                    self._send_json({'results': []}, 400)
                    return
                want = 'ESports' if sport == 'cs2' else 'Soccer'
                d = tsb_fetch('searchteams.php?t=' + urllib.parse.quote(q))
                teams = [t for t in (d.get('teams') or []) if not want or t.get('strSport') == want][:12]
                results = [{'id': t.get('idTeam'), 'name': t.get('strTeam') or '',
                            'full': t.get('strTeamAlternate') or t.get('strTeam') or '',
                            'league': t.get('strLeague') or '', 'badge': t.get('strBadge') or '',
                            'sport': t.get('strSport') or ''} for t in teams]
                self._send_json({'results': results})
                return
            if stype == 'matches':
                leagues = params.get('leagues', ['4328,4335,4331,4332,4334,4480'])[0]
                all_events = []
                for lid in [s.strip() for s in leagues.split(',') if s.strip()]:
                    lm = league_map.get(lid)
                    try:
                        d = tsb_fetch('eventsnextleague.php?id=' + lid)
                        for ev in (d.get('events') or []):
                            all_events.append(normalize_event(ev, lm))
                    except Exception:
                        continue
                all_events.sort(key=lambda m: m.get('ts') or '')
                self._send_json({'matches': all_events[:80]})
                return
            self._send_json({'error': 'unknown type'}, 400)
        except Exception:
            self._send_json({'results': [], 'matches': []}, 502)

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
