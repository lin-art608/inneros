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
import gzip
import base64
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor

# 简单内存缓存：{key: (expire_ts, payload)}——本地预览与线上 cf cacheTtl 行为对齐，避免重复外呼
HTTP_CACHE = {}
HTTP_CACHE_TTL = 600

def cached_fetch_json(cache_key, fetch_fn):
    hit = HTTP_CACHE.get(cache_key)
    if hit and hit[0] > time.time():
        return hit[1]
    data = fetch_fn()
    HTTP_CACHE[cache_key] = (time.time() + HTTP_CACHE_TTL, data)
    return data

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

    API_ORIGIN = 'https://inneros.pages.dev'

    def _proxy_api(self):
        # 本地版反代线上 API：云端账户/同步后端只有 Cloudflare 能访问 D1，
        # 本地 UI 请求同源 /api/auth、/api/sync，由这里转发到 inneros.pages.dev
        length = int(self.headers.get('Content-Length') or 0)
        body = self.rfile.read(length) if length else None
        req = urllib.request.Request(self.API_ORIGIN + self.path, data=body, method=self.command)
        for h in ('Content-Type', 'Cookie', 'Accept'):
            v = self.headers.get(h)
            if v:
                req.add_header(h, v)
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                status, payload = resp.status, resp.read()
                set_cookies = resp.headers.get_all('Set-Cookie') or []
        except urllib.error.HTTPError as e:
            status, payload = e.code, e.read()
            set_cookies = e.headers.get_all('Set-Cookie') or []
        except Exception as e:
            self._send_json({'error': '线上 API 不可达: ' + str(e)}, 502)
            return
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Cache-Control', 'no-cache')
        for sc in set_cookies:
            # 去掉 Domain 属性，让会话 Cookie 落在 localhost/局域网地址上
            parts = [p for p in sc.split(';') if not p.strip().lower().startswith('domain=')]
            self.send_header('Set-Cookie', ';'.join(parts))
        self.end_headers()
        if body is not None or payload:
            self.wfile.write(payload)

    def do_GET(self):
        if self.path.startswith('/api/auth') or self.path.startswith('/api/sync'):
            self._proxy_api()
        elif self.path.startswith('/img?url='):
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
        # 书籍详情：m.douban rexxar API 优先（与线上 douban.js 一致）；详情页 HTML 解析仅作兜底
        # （book.douban.com 详情页对数据中心 IP 302 反爬，2026-08 实测）
        try:
            body = self._fetch_url(f'https://m.douban.com/rexxar/api/v2/book/{did}',
                                   referer=f'https://m.douban.com/book/subject/{did}/')
            d = json.loads(body)
            segs = (d.get('card_subtitle') or '').split(' / ')
            press = d.get('press') or []
            pages_raw = d.get('pages')
            if isinstance(pages_raw, list):
                pages_raw = pages_raw[0] if pages_raw else ''
            pages_val = str(pages_raw or '').strip()
            pubdate = d.get('pubdate') or ['']
            price = d.get('price')
            if isinstance(price, list):
                price = price[0] if price else ''
            return {
                'external_id': str(d.get('id') or did),
                'authors': ' / '.join(d.get('author') or []),
                'publisher': ' / '.join(press) or (segs[1] if len(segs) >= 3 else ''),
                'isbn': d.get('isbn13') or d.get('isbn') or '',
                'pageCount': int(pages_val) if pages_val.isdigit() else 0,
                'publishedDate': pubdate[0] if pubdate else '',
                'description': d.get('intro') or '',
                'rating': ((d.get('rating') or {}).get('value') or None),
                'translator': ' / '.join(d.get('translator') or []),
                'price': price or '',
            }
        except Exception:
            return self._douban_book_detail_html(did)

    def _douban_book_detail_html(self, did):
        # 兜底：书籍详情页 HTML 解析：出版社 / ISBN / 页数 / 出版年 / 简介 / 作者
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

    def do_POST(self):
        if self.path.startswith('/api/auth') or self.path.startswith('/api/sync'):
            self._proxy_api()
        elif self.path.startswith('/api/webdav'):
            self.handle_webdav()
        else:
            self.send_error(404)

    def handle_webdav(self):
        # 与线上 functions/api/webdav.js 行为一致：转发 WebDAV（用户自己的坚果云/自建网盘），
        # 凭据仅随请求传入，本地/服务端均不存储（V1.2 §12：不提交密钥）
        try:
            length = int(self.headers.get('Content-Length') or 0)
            body = json.loads(self.rfile.read(length).decode('utf-8')) if length else {}
        except Exception:
            self._send_json({'error': 'bad json'}, 400)
            return
        op = body.get('op', '')
        url = (body.get('url') or '').strip()
        user = body.get('user') or ''
        password = body.get('pass') or ''
        loopback = url.startswith('http://127.0.0.1:') or url.startswith('http://localhost:')
        allowed = url.startswith('https://') or loopback
        if not url or not allowed:
            self._send_json({'error': '需要 https:// 开头的 WebDAV 地址'}, 400)
            return
        auth = 'Basic ' + base64.b64encode(f'{user}:{password}'.encode('utf-8')).decode('ascii')

        def wdav(method, extra_headers=None, data=None, target=None):
            req = urllib.request.Request(target or url, method=method)
            req.add_header('Authorization', auth)
            req.add_header('User-Agent', 'InnerOS-Sync/1.0')
            for k, v in (extra_headers or {}).items():
                req.add_header(k, v)
            with urllib.request.urlopen(req, data=data, timeout=25) as response:
                return response.status, response.read()

        def wdav_parent(method, parent_url):
            return wdav(method, target=parent_url)

        try:
            if op == 'test':
                # 探测父目录而非备份文件本身：首次使用时文件尚不存在，坚果云对"父目录缺失"按协议返回 409，
                # 会把正确的凭据误报为失败（409 应只在上传时出现，上传已带自动建目录）
                parent = re.sub(r'/[^/]*/?$', '/', url) or url
                status, _ = wdav('PROPFIND', {'Depth': '0'}, target=parent)
                self._send_json({'ok': 200 <= status < 300, 'status': status})
                return
            if op == 'get':
                try:
                    status, raw = wdav('GET')
                except urllib.error.HTTPError as e:
                    if e.code == 404:
                        self._send_json({'exists': False})
                        return
                    raise
                try:
                    self._send_json({'exists': True, 'snapshot': json.loads(raw.decode('utf-8'))})
                except Exception:
                    self._send_json({'error': '云端文件不是合法 JSON'}, 422)
                return
            if op == 'put':
                payload = body.get('data')
                if not isinstance(payload, str):
                    self._send_json({'error': 'data 需为 JSON 字符串'}, 400)
                    return
                data = payload.encode('utf-8')
                try:
                    status, _ = wdav('PUT', {'Content-Type': 'application/json'}, data)
                except urllib.error.HTTPError as e:
                    if e.code == 409:  # 父目录不存在：对父目录 MKCOL 后重试（此前误对文件 URL 发 MKCOL，导致建目录失败）
                        parent = re.sub(r'/[^/]*/?$', '/', url)
                        if parent and parent != url and parent.endswith('/'):
                            try:
                                wdav_parent('MKCOL', parent)
                            except Exception:
                                pass
                        status, _ = wdav('PUT', {'Content-Type': 'application/json'}, data)
                    else:
                        raise
                self._send_json({'ok': 200 <= status < 300, 'status': status})
                return
            self._send_json({'error': 'unknown op'}, 400)
        except urllib.error.HTTPError as e:
            tips = {
                401: '账号或应用密码不对（要用网盘生成的应用密码，不是登录密码）',
                403: '该账号没有 WebDAV 权限（检查应用密码是否被撤销）',
                405: '地址应指向一个文件路径（以 .json 结尾），而不是目录',
                520: '坚果云风控拦截了云服务器请求：线上版暂无法直连坚果云，请在本地版（localhost）使用云同步，或改用不拦截数据中心 IP 的 WebDAV 服务',
                409: '目标目录暂时冲突，请再点一次（上传会自动创建目录）',
            }
            self._send_json({'error': tips.get(e.code, f'WebDAV {e.code}')}, e.code)
        except Exception as e:
            self._send_json({'error': str(e)}, 502)

    def handle_sports(self):
        # 与线上 functions/api/sports.js 行为一致：TheSportsDB 代理（球队搜索 + 真实足球赛程）
        parsed = urllib.parse.urlparse(self.path)
        params = urllib.parse.parse_qs(parsed.query)
        stype = params.get('type', [''])[0]

        def tsb_fetch(path):
            def do():
                url = f'https://www.thesportsdb.com/api/v1/json/3/{path}'
                req = urllib.request.Request(url)
                req.add_header('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36')
                req.add_header('Accept', 'application/json')
                with urllib.request.urlopen(req, timeout=12) as response:
                    return json.loads(response.read().decode('utf-8', 'ignore'))
            return cached_fetch_json('tsdb:' + path, do)

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
                'home_badge': ev.get('strHomeTeamBadge') or '',
                'away_id': ev.get('idAwayTeam') or f"{ev.get('idEvent')}_a",
                'away_name': ev.get('strAwayTeam') or '',
                'away_badge': ev.get('strAwayTeamBadge') or '',
                'ts': ts,
                'date': ev.get('dateEvent') or '',
                'time': str(ev.get('strTime') or '')[:5],
                'league': lm[0] if lm else (ev.get('strLeague') or ''),
                'league_id': ev.get('idLeague') or '',
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
                            'sport': t.get('strSport') or '', 'provider': 'thesportsdb'} for t in teams]
                # TheSportsDB 电竞覆盖差（如搜 NAVI 无结果）→ Liquipedia opensearch 兜底
                if not results and sport == 'cs2':
                    results = self._lp_search_teams(q)
                self._send_json({'results': results})
                return
            if stype == 'matches':
                leagues = params.get('leagues', ['4328,4335,4331,4332,4334,4480'])[0]
                followed_ids = [s.strip() for s in params.get('ids', [''])[0].split(',') if s.strip()]
                ids = [s.strip() for s in leagues.split(',') if s.strip()]
                all_events = []

                def fetch_league(lid):
                    lm = league_map.get(lid)
                    try:
                        d = tsb_fetch('eventsnextleague.php?id=' + lid)
                        return [normalize_event(ev, lm) for ev in (d.get('events') or [])]
                    except Exception:
                        return []

                # 按关注球队拉取：下一场 + 最近完赛（V1.2 §6.1：联赛 fixtures 只有 1 场，主队赛程必须按队取）
                def fetch_team(tid):
                    out = []
                    for path in (f'eventsnext.php?id={tid}', f'eventslast.php?id={tid}'):
                        try:
                            d = tsb_fetch(path)
                            src = d.get('events') or d.get('results') or []
                            out.extend(normalize_event(ev, None) for ev in src)
                        except Exception:
                            continue
                    return out

                # 并行抓取（免费档限流宽松，缓存 10 分钟兜底）
                with ThreadPoolExecutor(max_workers=8) as pool:
                    futures = [pool.submit(fetch_league, lid) for lid in ids]
                    futures += [pool.submit(fetch_team, tid) for tid in followed_ids[:6]]
                    for fu in futures:
                        all_events.extend(fu.result())
                # 按事件去重后按时间排序
                seen = set()
                deduped = []
                for m in all_events:
                    key = f"{m.get('home_id')}|{m.get('away_id')}|{m.get('date')}"
                    if key in seen:
                        continue
                    seen.add(key)
                    deduped.append(m)
                deduped.sort(key=lambda m: m.get('ts') or '')
                self._send_json({'matches': deduped[:80]})
                return
            if stype == 'leagueseason':
                # 联赛近期赛程：eventsseason（免费档仅部分场次）+ eventsnextleague，去重合并；前端外链完整赛程
                lid = params.get('id', [''])[0].strip()
                if not lid:
                    self._send_json({'matches': []}, 400)
                    return
                lm = league_map.get(lid)
                seen, all_events = set(), []

                def push(m):
                    key = f"{m.get('home_id')}|{m.get('away_id')}|{m.get('date')}"
                    if key not in seen:
                        seen.add(key)
                        all_events.append(m)

                for season in ('2026-2027', '2026'):
                    try:
                        d = tsb_fetch(f'eventsseason.php?id={lid}&s={season}')
                        for ev in (d.get('events') or []):
                            push(normalize_event(ev, lm))
                    except Exception:
                        continue
                    if len(all_events) >= 8:
                        break
                try:
                    d = tsb_fetch('eventsnextleague.php?id=' + lid)
                    for ev in (d.get('events') or []):
                        push(normalize_event(ev, lm))
                except Exception:
                    pass
                all_events.sort(key=lambda m: m.get('ts') or '')
                self._send_json({'matches': all_events[:40]})
                return
            if stype == 'cs2matches':
                self._send_json({'matches': self._lp_cs2_matches()})
                return
            self._send_json({'error': 'unknown type'}, 400)
        except Exception:
            self._send_json({'results': [], 'matches': []}, 502)

    # Liquipedia API 合规：gzip 必需 + 描述性 UA + 缓存降频（≤2 req/s，见 liquipedia.net/api-terms-of-use）
    _lp_cache = {'ts': 0, 'data': None}

    def _lp_search_teams(self, q):
        # 电竞战队搜索兜底：opensearch 拿候选页名，队标取战队页 infobox 首图（各自缓存 10 分钟）
        def fetch_one(title):
            try:
                for _ in range(2):  # 重定向页（如 NAVI→Natus_Vincere）最多跟随一次
                    p = self._lp_fetch_json('https://liquipedia.net/counterstrike/api.php?action=parse&page='
                                            + urllib.parse.quote(title.replace(' ', '_')) + '&prop=text&format=json')
                    html = ((p.get('parse') or {}).get('text') or {}).get('*') or ''
                    m = (re.search(r'infobox-image[^>]*>[\s\S]{0,400}?<img[^>]*src="([^"]+)"', html)
                         or re.search(r'<img[^>]*src="(/commons/images/[^"]+?lightmode[^"]*?)"', html))
                    if m:
                        badge = m.group(1)
                        return ('https://liquipedia.net' + badge) if badge.startswith('/') else badge
                    red = re.search(r'redirectText"><li><a href="/counterstrike/([^"]+)"', html)
                    if not red:
                        return ''
                    title = urllib.parse.unquote(red.group(1))
                return ''
            except Exception:
                return ''

        try:
            d = self._lp_fetch_json('https://liquipedia.net/counterstrike/api.php?action=opensearch&search='
                                    + urllib.parse.quote(q) + '&limit=6&format=json')
            titles = [t for t in (d[1] or []) if '/' not in t][:4]
        except Exception:
            return []
        if not titles:
            return []
        with ThreadPoolExecutor(max_workers=2) as pool:  # 限速礼貌：并发≤2
            badges = list(pool.map(fetch_one, titles))
        return [{'id': 'lp:' + t, 'name': t, 'full': t, 'league': 'CS2 · Liquipedia',
                 'badge': badge, 'sport': 'ESports', 'provider': 'liquipedia'}
                for t, badge in zip(titles, badges)]

    def _lp_fetch_json(self, url):
        # 5 分钟内存缓存：与线上 cf cacheTtl=300 对齐，避免搜索/刷新高频打到 Liquipedia
        def do():
            req = urllib.request.Request(url)
            req.add_header('User-Agent', 'InnerOS/1.0 (https://inneros.pages.dev; contact: dev@inneros.asia)')
            req.add_header('Accept-Encoding', 'gzip')
            with urllib.request.urlopen(req, timeout=20) as response:
                raw = response.read()
                if (response.headers.get('Content-Encoding') or '') == 'gzip':
                    raw = gzip.decompress(raw)
                return json.loads(raw.decode('utf-8', 'ignore'))
        return cached_fetch_json('lp:' + url, do)

    def _lp_cs2_matches(self):
        # 本地内存缓存 5 分钟，与线上 cf cacheTtl=300 对齐，避免高频打到 Liquipedia
        now = time.time()
        if self._lp_cache['data'] and now - self._lp_cache['ts'] < 300:
            return self._lp_cache['data']
        d = self._lp_fetch_json('https://liquipedia.net/counterstrike/api.php?action=parse&page=Liquipedia:Matches&format=json&prop=text')
        html = ((d.get('parse') or {}).get('text') or {}).get('*') or ''
        if not html:
            raise RuntimeError('liquipedia empty')
        matches = self._parse_lp_ticker(html)
        self.__class__._lp_cache = {'ts': now, 'data': matches}
        return matches

    @classmethod
    def _parse_lp_ticker(cls, html):
        # 结构 2026-08 实测：match-info 块含 timer-object 时间戳、双方 team-template（队标+短名+LP 页面标题）、赛事名、Bo 赛制
        def parse_team(seg):
            img = (re.search(r'team-template-(?:lightmode|allmode)"><a[^>]*><img[^>]*src="([^"]+)"', seg)
                   or re.search(r'team-template-image-icon[^"]*"><a[^>]*><img[^>]*src="([^"]+)"', seg))
            name = re.search(r'<span class="name"[^>]*><a[^>]*title="([^"]*)"[^>]*>([^<]*)</a>', seg)
            badge = img.group(1) if img else ''
            if badge.startswith('/'):
                badge = 'https://liquipedia.net' + badge
            return {
                'full': name.group(1) if name else '',
                'name': name.group(2).strip() if name else '',
                'badge': badge,
            }

        now_ms = time.time() * 1000
        matches = []
        for b in html.split('<div class="match-info">')[1:]:
            parts = b.split('<div class="match-info-header-opponent')
            if len(parts) < 3:
                continue
            home, away = parse_team(parts[1]), parse_team(parts[2])
            if not home['name'] and not away['name']:
                continue
            ts_m = re.search(r'timer-object[^>]*data-timestamp="(\d+)"', b)
            ts = int(ts_m.group(1)) * 1000 if ts_m else 0
            tour_m = re.search(r'match-info-tournament-name"[^>]*>([\s\S]*?)</span>', b)
            league_html = tour_m.group(1) if tour_m else ''
            league = re.sub(r'<[^>]+>', '', league_html).strip()
            href_m = re.search(r'<a[^>]*href="([^"]+)"', league_html)
            league_url = ('https://liquipedia.net' + href_m.group(1)) if (href_m and href_m.group(1).startswith('/')) else (href_m.group(1) if href_m else '')
            bo_m = re.search(r'\((Bo\d)\)', b, re.I)
            scores = re.findall(r'match-info-header-scoreholder-score[^\"]*\">\s*(-?\d+)\s*<', b)
            status, hs, as_ = 'upcoming', None, None
            if ts and now_ms >= ts and now_ms < ts + 3.5 * 3600 * 1000:
                status = 'live'
            elif ts and now_ms >= ts + 3.5 * 3600 * 1000:
                status = 'finished'
                if len(scores) >= 2:
                    hs, as_ = int(scores[0]), int(scores[1])
            d = datetime.utcfromtimestamp(ts / 1000) if ts else datetime.utcnow()
            slug = re.sub(r'[^a-z0-9-]', '', (home['name'] + '-' + away['name']).lower())
            matches.append({
                'sport': 'cs2',
                'id': f"lp-{int(ts / 1000)}-{slug}",
                'home_id': home['full'] or home['name'], 'home_name': home['name'], 'home_badge': home['badge'],
                'away_id': away['full'] or away['name'], 'away_name': away['name'], 'away_badge': away['badge'],
                'ts': ts, 'date': d.strftime('%Y-%m-%d'), 'time': d.strftime('%H:%M'),
                'league': league, 'league_url': league_url, 'round': bo_m.group(1) if bo_m else '',
                'status': status, 'home_score': hs, 'away_score': as_,
                'importance': 3, 'tournament_weight': 3,
            })
        return matches

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
