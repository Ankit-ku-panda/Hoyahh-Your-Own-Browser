import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import unittest
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tor'))
from reader import normalize_url, extract_page
import fetcher

class ReaderTests(unittest.TestCase):
    def response(self, body=b'<html><title>Example</title><p>Text</p></html>', status=200, headers='Content-Type: text/html'):
        return subprocess.CompletedProcess([],0,f'HTTP/1.1 {status} Response\r\n{headers}\r\n\r\n'.encode()+body)
    def test_unsafe_targets_rejected(self):
        for url in ('file:///etc/passwd','http://localhost','https://127.0.0.1','https://[::1]/','https://127.1/', 'https://2130706433/', 'https://service.internal/', 'https://user:pass@example.org/', 'https://example.org:8443/', 'https://example.org\\@localhost/', 'https://%31%32%37.0.0.1/', 'https://example.org/\r\nX:y'):
            with self.subTest(url=url), self.assertRaises(ValueError): normalize_url(url)
        self.assertEqual(normalize_url('http://example.org/a#part'), 'https://example.org/a')
    def test_page_contains_only_text_and_validated_links(self):
        html=b'''<html><head><title>A title</title><base href="https://evil.example/">
        <meta http-equiv="refresh" content="0;url=https://evil.example/"></head><body>
        <script>fetch('https://evil.example/')</script><style>body{background:url(https://evil.example)}</style>
        <h1>Hello</h1><p>Read <a href="/next" onclick="alert(1)">next page</a> here.</p>
        <img src="https://evil.example/pixel" onerror="alert(1)">
        <iframe src="https://evil.example/"></iframe><form><input name="password">secret form</form>
        <p><a href="javascript:alert(1)">Unsafe link as text</a></p></body></html>'''
        page=extract_page(html,'https://example.org/start','text/html; charset=utf-8')
        self.assertEqual(page['title'],'A title')
        parts=[p for b in page['blocks'] for p in b['segments']]
        self.assertIn({'text':'next page','url':'https://example.org/next'},parts)
        text=json.dumps(page)
        for forbidden in ('onclick','onerror','fetch(', 'secret form','evil.example','javascript:'):
            self.assertNotIn(forbidden,text)
        self.assertIn('Unsafe link as text',text)
        self.assertTrue(all(set(p)<= {'text','url'} for p in parts))
    def test_fetch_uses_tor_without_cookies_redirect_flags_or_shell(self):
        with patch.object(fetcher.subprocess,'run',return_value=self.response()) as call:
            page=fetcher.fetch_page('https://example.org/')
            self.assertEqual(page['title'],'Example')
            args=call.call_args.args[0]
            self.assertEqual(args[:2],['curl','--disable'])
            self.assertEqual(args[args.index('--socks5-hostname')+1],'127.0.0.1:9050')
            self.assertIn('--globoff',args)
            self.assertNotIn('--location',args)
            self.assertNotIn('--cookie',args)
            self.assertFalse(call.call_args.kwargs.get('shell',False))
    def test_redirect_revalidated_before_second_request(self):
        for target in ('http://127.0.0.1/', 'file:///etc/passwd','https://service.internal/'):
            with patch.object(fetcher.subprocess,'run',return_value=self.response(status=302,headers='Location: '+target)) as call:
                with self.assertRaises(ValueError): fetcher.fetch_page('https://example.org/')
                call.assert_called_once()
    def test_relative_redirects_keep_tor_and_reject_http_downgrade_by_upgrade(self):
        with patch.object(fetcher.subprocess,'run',side_effect=[self.response(status=302,headers='Location: /next'),self.response()]) as call:
            page=fetcher.fetch_page('https://example.org/')
            self.assertEqual(page['url'],'https://example.org/next')
            self.assertEqual(call.call_count,2)
            self.assertTrue(all('--socks5-hostname' in c.args[0] for c in call.call_args_list))
    def test_network_errors_do_not_fall_back(self):
        with patch.object(fetcher.subprocess,'run',side_effect=subprocess.CalledProcessError(7,'curl')) as call:
            with self.assertRaises(ValueError): fetcher.fetch_page('https://example.org/')
            call.assert_called_once()
    def test_unsupported_files_and_compression_rejected(self):
        for headers in ('Content-Type: application/pdf','Content-Type: text/html\r\nContent-Encoding: gzip'):
            with patch.object(fetcher.subprocess,'run',return_value=self.response(headers=headers)):
                with self.assertRaises(ValueError): fetcher.fetch_page('https://example.org/')
    def test_redirect_loop_and_oversized_response_rejected(self):
        for response in (self.response(status=302,headers='Location: /'),self.response(body=b'x'*(fetcher.MAX_BYTES+65537))):
            with patch.object(fetcher.subprocess,'run',return_value=response) as call:
                with self.assertRaises(ValueError): fetcher.fetch_page('https://example.org/')
                call.assert_called_once()
    def test_plain_text_is_inert_and_limited(self):
        page=extract_page(b'<script>not code</script>','https://example.org/','text/plain')
        self.assertEqual(page['blocks'][0]['segments'][0]['text'],'<script>not code</script>')
        page=extract_page(b'a'*120001,'https://example.org/','text/plain')
        self.assertTrue(page['truncated'])
        self.assertEqual(len(page['blocks'][0]['segments'][0]['text']),120000)

if __name__=='__main__':unittest.main()
