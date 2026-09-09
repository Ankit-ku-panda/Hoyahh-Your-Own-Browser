"""Local-only Hoyahh gateway. No dependencies, query logs, or persistent search state."""
import ipaddress
import json
import os
import re
import socket
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import URLError, HTTPError
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit
from urllib.request import Request, build_opener, ProxyHandler, HTTPRedirectHandler

from reader import normalize_url

ROOT = Path(__file__).resolve().parent / 'dist'
UPSTREAM = os.environ.get('SEARXNG_URL', 'http://127.0.0.1:8080').rstrip('/')
TOR_STATUS_URL = os.environ.get('TOR_STATUS_URL', 'http://tor:9080/status')
TOR_READER_URL = os.environ.get('TOR_READER_URL', 'http://tor:9080/fetch')
PORT = int(os.environ.get('PORT', '8787'))
HOSTS = {f'localhost:{PORT}', f'127.0.0.1:{PORT}'}
SLOTS = threading.BoundedSemaphore(4)
MAX_RESPONSE = 5 * 1024 * 1024

class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None

# No inherited system proxy or forwarded browser identity headers.
OPENER = build_opener(ProxyHandler({}), NoRedirect())

def tor_status():
    try:
        with OPENER.open(TOR_STATUS_URL, timeout=30) as response:
            raw = response.read(4097)
        if len(raw) > 4096:
            raise ValueError('Too large')
        data = json.loads(raw)
        if not isinstance(data, dict) or data.get('tor_verified') is not True:
            raise ValueError('Tor not verified')
        address = ipaddress.ip_address(data.get('probe_exit_ip', ''))
        if not address.is_global:
            raise ValueError('Invalid exit IP')
        return {'tor_verified': True, 'probe_exit_ip': str(address)}
    except (URLError, OSError, ValueError, TypeError):
        return {'tor_verified': False}

def provider_failures(value):
    """Expose bounded categories, never raw errors that could contain queries."""
    if not isinstance(value, list):
        return []
    failures = []
    for entry in value[:30]:
        if not isinstance(entry, (list, tuple)) or len(entry) < 2:
            continue
        name = entry[0]
        if not isinstance(name, str) or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9 ._()+/-]{0,79}', name):
            continue
        message = entry[1].lower() if isinstance(entry[1], str) else ''
        if 'captcha' in message:
            reason = 'CAPTCHA requested'
        elif 'timeout' in message or 'timed out' in message:
            reason = 'Timed out'
        elif '429' in message or 'too many' in message:
            reason = 'Rate limited'
        elif '403' in message or 'denied' in message or 'forbidden' in message:
            reason = 'Access denied'
        elif 'suspend' in message:
            reason = 'Temporarily suspended'
        else:
            reason = 'Provider error'
        failures.append({'name': name, 'reason': reason})
    return failures

def clean_url(value):
    if not isinstance(value, str) or any(ord(c) < 32 for c in value):
        return None
    try:
        url = urlsplit(value)
        if url.scheme not in ('http', 'https') or not url.hostname or url.username or url.password:
            return None
        _ = url.port
        params = [(k, v) for k, v in parse_qsl(url.query, keep_blank_values=True)
                  if not k.lower().startswith('utm_') and k.lower() not in
                  {'fbclid', 'gclid', 'dclid', 'msclkid', 'mc_cid', 'mc_eid'}]
        # Preserve the original URL exactly when there are no known tracking parameters.
        query = urlencode(params) if len(params) != len(parse_qsl(url.query, keep_blank_values=True)) else url.query
        return urlunsplit((url.scheme, url.netloc, url.path, query, url.fragment))
    except ValueError:
        return None

def validate(data):
    if not isinstance(data, dict):
        raise ValueError('Invalid search request.')
    q = data.get('q')
    if not isinstance(q, str) or not 1 <= len(q.strip()) <= 500:
        raise ValueError('Enter a search between 1 and 500 characters.')
    category = data.get('category', 'general')
    period = data.get('time', '')
    safe = data.get('safe', '1')
    page = data.get('page', 1)
    if category not in ('general', 'news', 'science') or period not in ('', 'day', 'week', 'month', 'year') or safe not in ('0', '1', '2'):
        raise ValueError('Invalid search filter.')
    if type(page) is not int or not 1 <= page <= 50:
        raise ValueError('Choose a page between 1 and 50.')
    return {'q': q.strip(), 'categories': category, 'time_range': period,
            'safesearch': safe, 'pageno': page, 'format': 'json', 'language': 'en'}

class Handler(BaseHTTPRequestHandler):
    server_version = 'Hoyahh'
    sys_version = ''
    def setup(self):
        super().setup()
        self.connection.settimeout(90)
    def log_message(self, *args):
        pass
    def send_error(self, code, message=None, explain=None):
        self.respond(code, {'error': 'Request not supported.'})
    def respond(self, code, body, mime='application/json; charset=utf-8'):
        raw = json.dumps(body).encode() if isinstance(body, dict) else body
        self.send_response(code)
        self.send_header('Content-Type', mime)
        self.send_header('Content-Length', str(len(raw)))
        self.send_header('Cache-Control', 'no-store, max-age=0')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Referrer-Policy', 'no-referrer')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('X-Frame-Options', 'DENY')
        self.send_header('X-Robots-Tag', 'noindex, nofollow')
        self.send_header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
        self.send_header('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; object-src 'none'")
        self.end_headers()
        try:
            self.wfile.write(raw)
        except (BrokenPipeError, ConnectionResetError):
            pass
    def valid_host(self):
        return self.headers.get('Host') in HOSTS
    def do_GET(self):
        if not self.valid_host():
            return self.respond(403, {'error': 'Use localhost to open Hoyahh.'})
        files = {'/': ('index.html', 'text/html; charset=utf-8'),
                 '/style.css': ('style.css', 'text/css; charset=utf-8'),
                 '/app.js': ('app.js', 'text/javascript; charset=utf-8'),
                 '/favicon.svg': ('favicon.svg', 'image/svg+xml')}
        if self.path == '/api/health':
            return self.respond(200, {'status': 'ready'})
        if self.path not in files:
            return self.respond(404, {'error': 'Not found.'})
        name, mime = files[self.path]
        return self.respond(200, (ROOT / name).read_bytes(), mime)
    def do_POST(self):
        if not self.valid_host():
            return self.respond(403, {'error': 'Use localhost to open Hoyahh.'})
        # Host validation blocks DNS rebinding. Custom header + JSON + Origin validation
        # blocks cross-site forms/fetch. No CORS is enabled.
        origin = self.headers.get('Origin')
        if (self.headers.get('X-Veil-Request') != '1'
                or (origin is not None and origin != 'http://' + self.headers['Host'])
                or self.headers.get('Sec-Fetch-Site') == 'cross-site'):
            return self.respond(403, {'error': 'Open Hoyahh directly on localhost.'})
        if self.path == '/api/connection':
            status = tor_status()
            return self.respond(200 if status['tor_verified'] else 503, status)
        if self.path == '/api/read':
            return self.read_page()
        if self.path != '/api/search':
            return self.respond(404, {'error': 'Not found.'})
        if self.headers.get('Content-Type', '').split(';')[0].strip() != 'application/json':
            return self.respond(415, {'error': 'Use a JSON search request.'})
        try:
            size = int(self.headers.get('Content-Length', '0'))
            if not 0 < size <= 8192 or self.headers.get('Transfer-Encoding'):
                raise ValueError('Invalid request size.')
            params = validate(json.loads(self.rfile.read(size)))
        except (ValueError, UnicodeError, socket.timeout):
            return self.respond(400, {'error': 'Invalid search. Use 1–500 characters and valid filters.'})
        if not SLOTS.acquire(blocking=False):
            return self.respond(429, {'error': 'Other searches are finishing. Try again shortly.'})
        try:
            route = tor_status()
            if not route['tor_verified']:
                return self.respond(503, {'error': 'Search blocked: Tor could not be verified. Wait for Tor to connect, then check again. No direct fallback is enabled.'})
            request = Request(UPSTREAM + '/search', data=urlencode(params).encode(),
                              headers={'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json', 'User-Agent': 'VeilSearch/1.0'})
            with OPENER.open(request, timeout=60) as response:
                raw = response.read(MAX_RESPONSE + 1)
            if len(raw) > MAX_RESPONSE:
                raise ValueError('Response too large')
            data = json.loads(raw)
            results = []
            for item in data.get('results', [])[:60]:
                if not isinstance(item, dict):
                    continue
                url = clean_url(item.get('url'))
                if url:
                    engines = item.get('engines', [])
                    results.append({'url': url, 'title': str(item.get('title', ''))[:1000],
                                    'content': str(item.get('content') or '')[:4000],
                                    'engines': [str(e)[:80] for e in engines[:10]] if isinstance(engines, list) else []})
            return self.respond(200, {'results': results, 'partial': bool(data.get('unresponsive_engines')), 'provider_failures': provider_failures(data.get('unresponsive_engines')), 'route': route})
        except (URLError, OSError, ValueError, AttributeError, TypeError):
            return self.respond(502, {'error': 'SearXNG is unavailable or still starting. Wait a minute and try again. If it persists, check the troubleshooting steps in README.md.'})
        finally:
            SLOTS.release()


    def read_page(self):
        if self.headers.get('Content-Type', '').split(';')[0].strip() != 'application/json':
            return self.respond(415, {'error':'Use a JSON page request.'})
        try:
            size = int(self.headers.get('Content-Length', '0'))
            if not 0 < size <= 16384 or self.headers.get('Transfer-Encoding'):
                raise ValueError('Invalid request.')
            data = json.loads(self.rfile.read(size))
            url = normalize_url(data.get('url')) if isinstance(data, dict) else None
            if not url:
                raise ValueError('Invalid URL.')
        except (ValueError, UnicodeError, OSError):
            return self.respond(400, {'error':'Enter a public web address. Local addresses, credentials, and special ports are not supported.'})
        if not SLOTS.acquire(blocking=False):
            return self.respond(429, {'error':'Other requests are finishing. Try again shortly.'})
        try:
            route = tor_status()
            if not route['tor_verified']:
                return self.respond(503, {'error':'Page blocked: Tor could not be verified. No direct connection was used.'})
            request = Request(TOR_READER_URL, data=json.dumps({'url':url}).encode(), headers={
                'Content-Type':'application/json', 'X-Veil-Reader':'1'})
            try:
                response = OPENER.open(request, timeout=60)
            except HTTPError as error:
                response = error
            with response:
                code = response.status
                raw = response.read(MAX_RESPONSE+1)
            if len(raw)>MAX_RESPONSE:
                raise ValueError('Too large')
            page = json.loads(raw)
            if not isinstance(page, dict):
                raise ValueError('Invalid response')
            if code != 200:
                return self.respond(502, {'error':str(page.get('error','The page could not be read through Tor.'))[:250]})
            return self.respond(200, {**page, 'route':route})
        except (URLError, OSError, ValueError, TypeError):
            return self.respond(502, {'error':'The reader is unavailable. Make sure Tor is running and try again.'})
        finally:
            SLOTS.release()

class QuietServer(ThreadingHTTPServer):
    daemon_threads = True
    def handle_error(self, request, client_address):
        pass

if __name__ == '__main__':
    bind = os.environ.get('BIND_ADDRESS', '127.0.0.1')
    print(f'Hoyahh: http://localhost:{PORT} (no request logging)', flush=True)
    QuietServer((bind, PORT), Handler).serve_forever()
