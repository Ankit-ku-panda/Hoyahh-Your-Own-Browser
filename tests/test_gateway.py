"""Exercise the browser relay against the actual app handler on loopback."""
import http.client
from pathlib import Path
import sys
import threading
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import gateway
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tor'))
import server

class GatewayTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.original_target = gateway.TARGET
        cls.original_hosts = server.HOSTS.copy()
        cls.app = server.QuietServer(('127.0.0.1', 0), server.Handler)
        gateway.TARGET = ('127.0.0.1', cls.app.server_port)
        cls.relay = gateway.Server(('127.0.0.1', 0), gateway.Handler)
        cls.port = cls.relay.server_address[1]
        server.HOSTS.add(f'127.0.0.1:{cls.port}')
        for service in (cls.app, cls.relay):
            threading.Thread(target=service.serve_forever, daemon=True).start()
    @classmethod
    def tearDownClass(cls):
        for service in (cls.relay, cls.app):
            service.shutdown(); service.server_close()
        gateway.TARGET = cls.original_target
        server.HOSTS = cls.original_hosts
    def request(self, method, path, body=None, headers=None):
        connection = http.client.HTTPConnection('127.0.0.1', self.port, timeout=5)
        try:
            connection.request(method, path, body=body, headers=headers or {})
            response = connection.getresponse()
            return response.status, dict(response.getheaders()), response.read()
        finally:
            connection.close()
    def test_relay_serves_real_health_and_privacy_headers(self):
        code, headers, body = self.request('GET', '/api/health')
        self.assertEqual(code, 200)
        self.assertIn(b'"ready"', body)
        self.assertIn('no-store', headers['Cache-Control'])
        self.assertEqual(headers['Referrer-Policy'], 'no-referrer')
    def test_relay_preserves_origin_check_and_rejects_proxy_style_requests(self):
        code, _, _ = self.request('POST', '/api/search', '{"q":"test"}', {
            'Content-Type':'application/json','X-Veil-Request':'1','Origin':'https://other.example'})
        self.assertEqual(code, 403)
        code, _, _ = self.request('GET', 'http://other.example/', headers={'Host':f'127.0.0.1:{self.port}'})
        self.assertEqual(code, 404)

if __name__ == '__main__': unittest.main()
