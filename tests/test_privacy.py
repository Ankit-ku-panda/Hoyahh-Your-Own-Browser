"""Gateway integration checks using a local mock upstream, never real searches."""
import contextlib
import io
import json
import sys
import threading
import unittest
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.request import Request, urlopen
from urllib.error import HTTPError
from urllib.parse import parse_qs
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tor'))
import server

class Upstream(BaseHTTPRequestHandler):
    received = None
    route = {'tor_verified': True, 'probe_exit_ip': '185.220.101.1'}
    def log_message(self, *args): pass
    def do_GET(self):
        raw = json.dumps(Upstream.route).encode()
        self.send_response(200); self.end_headers(); self.wfile.write(raw)
    def do_POST(self):
        Upstream.received = (self.path, dict(self.headers), parse_qs(self.rfile.read(int(self.headers['Content-Length'])).decode()))
        if self.path == '/fetch':
            data = {'url':'https://example.org/','title':'Read example','blocks':[{'kind':'paragraph','segments':[{'text':'Page text'}]}]}
            raw=json.dumps(data).encode();self.send_response(200);self.end_headers();self.wfile.write(raw);return
        data = {'results': [{'title': '<script>alert(1)</script>', 'url': 'https://example.org/page?utm_source=x&keep=yes', 'content': 'A result', 'engines': ['example']}, {'url': 'javascript:alert(1)'}], 'unresponsive_engines': [['example2', 'timeout']]}
        raw = json.dumps(data).encode()
        self.send_response(200); self.end_headers(); self.wfile.write(raw)

class PrivacyTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.upstream = ThreadingHTTPServer(('127.0.0.1', 0), Upstream)
        cls.app = server.QuietServer(('127.0.0.1', 0), server.Handler)
        cls.port = cls.app.server_port
        server.HOSTS = {f'127.0.0.1:{cls.port}', f'localhost:{cls.port}'}
        server.UPSTREAM = f'http://127.0.0.1:{cls.upstream.server_port}'
        server.TOR_STATUS_URL = server.UPSTREAM + '/status'
        server.TOR_READER_URL = server.UPSTREAM + '/fetch'
        for service in (cls.upstream, cls.app):
            threading.Thread(target=service.serve_forever, daemon=True).start()
    @classmethod
    def tearDownClass(cls):
        for service in (cls.app, cls.upstream): service.shutdown(); service.server_close()
    def request(self, data=None, headers=None, path='/api/search'):
        h = {'Content-Type':'application/json', 'X-Veil-Request':'1', 'Origin':f'http://127.0.0.1:{self.port}'}
        h.update(headers or {})
        req = Request(f'http://127.0.0.1:{self.port}{path}', data=json.dumps(data).encode() if data is not None else None, headers=h)
        try: response = urlopen(req, timeout=3)
        except HTTPError as error: response = error
        with response: return response.status, response.headers, response.read()
    def test_search_post_normalization_and_no_browser_identity(self):
        code, headers, raw = self.request({'q':'private example', 'page':2}, {'Cookie':'secret=abc', 'User-Agent':'BrowserIdentity'})
        data=json.loads(raw)
        self.assertEqual(code, 200)
        self.assertEqual(len(data['results']), 1)
        self.assertEqual(data['results'][0]['url'], 'https://example.org/page?keep=yes')
        self.assertTrue(data['partial'])
        self.assertEqual(data['provider_failures'], [{'name':'example2','reason':'Timed out'}])
        path, upstream_headers, params = Upstream.received
        self.assertEqual(path, '/search')
        self.assertEqual(params['q'], ['private example'])
        self.assertEqual(params['pageno'], ['2'])
        self.assertNotIn('Cookie', upstream_headers)
        self.assertEqual(upstream_headers['User-Agent'], 'VeilSearch/1.0')
        self.assertIn('no-store', headers['Cache-Control'])
        self.assertNotIn('Set-Cookie', headers)
    def test_cross_site_and_rebinding_rejected(self):
        for headers in ({'Origin':'https://evil.example'}, {'Host':'evil.example'}, {'X-Veil-Request':''}, {'Sec-Fetch-Site':'cross-site'}):
            self.assertEqual(self.request({'q':'example'}, headers)[0], 403)
    def test_invalid_requests(self):
        for data in ({'q':''}, {'q':'a'*501}, {'q':'x','page':True}, {'q':'x','page':0}, {'q':'x','category':[]}, [], {'q':'x','safe':9}):
            self.assertEqual(self.request(data)[0], 400)
    def test_assets_and_path_allowlist(self):
        code, headers, raw = self.request(path='/')
        self.assertEqual(code,200)
        self.assertIn(b'Veil Search',raw)
        self.assertIn("frame-ancestors 'none'", headers['Content-Security-Policy'])
        self.assertEqual(headers['Referrer-Policy'],'no-referrer')
        for path in ('/.env','/server.py','/../server.py','/api/search?q=secret'):
            self.assertEqual(self.request(path=path)[0],404)
    def test_upstream_failure_does_not_echo_query(self):
        old=server.UPSTREAM
        server.UPSTREAM='http://127.0.0.1:1'
        try:
            code, headers, raw = self.request({'q':'sensitive test words'})
            self.assertEqual(code,502)
            self.assertNotIn(b'sensitive test words',raw)
        finally: server.UPSTREAM=old
    def test_no_access_log(self):
        stream=io.StringIO()
        with contextlib.redirect_stderr(stream): self.request({'q':'never log this'})
        self.assertEqual(stream.getvalue(),'')
    def test_tor_failure_blocks_before_query_forwarding(self):
        old = Upstream.route
        try:
            for route in ({'tor_verified': False}, {'tor_verified': 'true', 'probe_exit_ip':'185.220.101.1'}, {'tor_verified': True, 'probe_exit_ip':'127.0.0.1'}, []):
                Upstream.route = route
                Upstream.received = None
                code, headers, raw = self.request({'q':'do not forward this'})
                self.assertEqual(code, 503)
                self.assertIsNone(Upstream.received)
                self.assertNotIn(b'do not forward this', raw)
        finally:
            Upstream.route = old
    def test_route_check_unavailable_blocks_search(self):
        old = server.TOR_STATUS_URL
        server.TOR_STATUS_URL = 'http://127.0.0.1:1/status'
        Upstream.received = None
        try:
            self.assertEqual(self.request({'q':'private example'})[0], 503)
            self.assertIsNone(Upstream.received)
        finally:
            server.TOR_STATUS_URL = old
    def test_connection_status_uses_real_checker_response(self):
        code, headers, raw = self.request({}, path='/api/connection')
        self.assertEqual(code, 200)
        self.assertEqual(json.loads(raw), Upstream.route)
        self.assertEqual(self.request({}, {'Origin':'https://evil.example'}, path='/api/connection')[0], 403)
    def test_provider_errors_do_not_echo_raw_queries_or_urls(self):
        errors = [['google', 'CAPTCHA for https://example.org?q=private-words'],
                  ['bing', 'private-words caused unknown failure'],
                  ['bad?query=private-words', 'timeout'], None]
        result = server.provider_failures(errors)
        self.assertEqual(result, [{'name':'google','reason':'CAPTCHA requested'}, {'name':'bing','reason':'Provider error'}])
        self.assertNotIn('private-words', json.dumps(result))
        self.assertEqual(server.provider_failures('invalid'), [])
    def test_reader_uses_internal_proxy_and_preserves_headers(self):
        code, headers, raw=self.request({'url':'https://example.org/'},path='/api/read')
        self.assertEqual(code,200)
        self.assertEqual(json.loads(raw)['title'],'Read example')
        self.assertEqual(Upstream.received[0],'/fetch')
        self.assertEqual(Upstream.received[1]['X-Veil-Reader'],'1')
        self.assertIn('no-store',headers['Cache-Control'])
    def test_reader_refuses_private_target_cross_site_and_tor_failure(self):
        self.assertEqual(self.request({'url':'http://localhost/'},path='/api/read')[0],400)
        self.assertEqual(self.request({'url':'https://example.org/'},{'Origin':'https://other.example'},path='/api/read')[0],403)
        old=Upstream.route
        try:
            Upstream.route={'tor_verified':False};Upstream.received=None
            self.assertEqual(self.request({'url':'https://example.org/'},path='/api/read')[0],503)
            self.assertIsNone(Upstream.received)
        finally:Upstream.route=old
    def test_unsafe_urls(self):
        for url in ('javascript:alert(1)', 'data:text/html,x', 'https://name:password@example.org/', 'https://example.org:invalid', 'https://example.org/\nfoo'):
            self.assertIsNone(server.clean_url(url))

if __name__ == '__main__': unittest.main()
