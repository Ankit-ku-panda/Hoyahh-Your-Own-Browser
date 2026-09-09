"""Fetch a bounded HTTPS page through Tor. Redirects are revalidated at every hop."""
import subprocess
import time
from urllib.parse import urljoin
from reader import extract_page, normalize_url

MAX_BYTES = 2 * 1024 * 1024

def parse_response(raw):
    for _ in range(6):
        head, separator, body = raw.partition(b'\r\n\r\n')
        if not separator or len(head)>65536:
            raise ValueError('The website sent an unsupported response.')
        lines = head.split(b'\r\n')
        try:
            status = int(lines[0].split()[1])
        except (ValueError, IndexError):
            raise ValueError('The website sent an invalid response.') from None
        headers = {}
        for line in lines[1:]:
            key, sep, value = line.partition(b':')
            if sep:
                headers[key.decode('ascii', errors='ignore').lower()] = value.decode('latin-1').strip()
        if 100 <= status < 200:
            raw = body
            continue
        return status, headers, body
    raise ValueError('Too many response headers.')

def fetch_page(value):
    url = normalize_url(value)
    visited = set()
    deadline = time.monotonic() + 50
    for _ in range(5):
        if url in visited:
            raise ValueError('This website has a redirect loop.')
        visited.add(url)
        remaining = min(30, int(deadline - time.monotonic()))
        if remaining < 1:
            raise ValueError('The website took too long to respond through Tor.')
        try:
            result = subprocess.run([
                'curl', '--disable', '--silent', '--globoff', '--http1.1',
                '--max-time', str(remaining), '--max-filesize', str(MAX_BYTES),
                '--proto', '=https', '--noproxy', '', '--socks5-hostname', '127.0.0.1:9050',
                '--disallow-username-in-url', '--include',
                '--header', 'Accept: text/html,application/xhtml+xml,text/plain;q=0.9',
                '--header', 'Accept-Encoding: identity',
                '--user-agent', 'VeilReader/1.0', '--url', url,
            ], capture_output=True, timeout=remaining+2, check=True)
        except (subprocess.SubprocessError, OSError):
            raise ValueError('The page could not be loaded through Tor. It may be blocked, too large, or unavailable.') from None
        if len(result.stdout) > MAX_BYTES+65536:
            raise ValueError('This page is too large for the reader.')
        status, headers, body = parse_response(result.stdout)
        if status in (301,302,303,307,308):
            target = headers.get('location')
            if not target:
                raise ValueError('The website returned a redirect without an address.')
            url = normalize_url(urljoin(url, target))
            continue
        if status in (401,403,429):
            raise ValueError('This website requires sign-in, blocks the reader, or is rate limiting Tor requests.')
        if not 200 <= status < 300:
            raise ValueError(f'The website returned HTTP {status}.')
        if headers.get('content-encoding', 'identity').lower() != 'identity':
            raise ValueError('The website requires a response encoding this reader does not support.')
        return extract_page(body, url, headers.get('content-type', ''))
    raise ValueError('The website redirected too many times.')
