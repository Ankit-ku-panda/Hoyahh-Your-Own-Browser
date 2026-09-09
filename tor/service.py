"""Tor client, fixed-destination verification, and a bounded HTTPS text reader."""
import ipaddress
import json
import signal
import subprocess
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from fetcher import fetch_page

CHECK_URL = 'https://check.torproject.org/api/ip'
CHECK_SLOTS = threading.BoundedSemaphore(4)

def check_route():
    # --disable ignores curlrc; explicit socks5-hostname routes destination DNS via Tor.
    # No redirects, direct fallback, user-supplied destinations, or browser headers.
    result = subprocess.run([
        'curl', '--disable', '--silent', '--fail', '--max-time', '25',
        '--max-filesize', '4096', '--proto', '=https', '--noproxy', '',
        '--socks5-hostname', '127.0.0.1:9050', CHECK_URL,
    ], capture_output=True, timeout=28, check=True)
    data = json.loads(result.stdout)
    if not isinstance(data, dict) or data.get('IsTor') is not True:
        raise ValueError('Tor was not verified')
    ip = ipaddress.ip_address(data.get('IP', ''))
    if not ip.is_global:
        raise ValueError('Invalid exit address')
    return {'tor_verified': True, 'probe_exit_ip': str(ip)}

class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args): pass
    def do_GET(self):
        if self.path != '/status':
            code, data = 404, {'tor_verified': False}
        elif not CHECK_SLOTS.acquire(blocking=False):
            code, data = 503, {'tor_verified': False}
        else:
            try:
                data = check_route()
                code = 200
            except (subprocess.SubprocessError, OSError, ValueError, TypeError):
                code, data = 503, {'tor_verified': False}
            finally:
                CHECK_SLOTS.release()
        self.reply(code, data)
    def do_POST(self):
        if self.path != '/fetch' or self.headers.get('X-Veil-Reader') != '1':
            return self.reply(403, {'error':'Unsupported request.'})
        try:
            size = int(self.headers.get('Content-Length', '0'))
            if not 0 < size <= 16384 or self.headers.get('Transfer-Encoding'):
                raise ValueError('Invalid request.')
            self.connection.settimeout(10)
            data = json.loads(self.rfile.read(size))
            if not isinstance(data, dict):
                raise ValueError('Invalid request.')
        except (OSError, ValueError):
            return self.reply(400, {'error':'Invalid page request.'})
        if not CHECK_SLOTS.acquire(blocking=False):
            return self.reply(503, {'error':'The reader is busy. Try again shortly.'})
        try:
            return self.reply(200, fetch_page(data.get('url')))
        except ValueError as error:
            return self.reply(422, {'error':str(error)})
        except Exception:
            return self.reply(502, {'error':'The page could not be read through Tor.'})
        finally:
            CHECK_SLOTS.release()
    def reply(self, code, data):
        raw = json.dumps(data).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(raw)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        try: self.wfile.write(raw)
        except (BrokenPipeError, ConnectionResetError): pass

class Server(ThreadingHTTPServer):
    daemon_threads = True
    def handle_error(self, request, client_address): pass

if __name__ == '__main__':
    stopping = threading.Event()
    failure = []
    tor = subprocess.Popen(['tor', '-f', '/etc/tor/torrc'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    server = Server(('0.0.0.0', 9080), Handler)
    def stop(*args):
        stopping.set()
        threading.Thread(target=server.shutdown, daemon=True).start()
    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    def watch():
        code = tor.wait()
        if not stopping.is_set():
            failure.append(code if code > 0 else 1)
        stop()
    threading.Thread(target=watch, daemon=True).start()
    try: server.serve_forever()
    finally:
        server.server_close()
        tor.terminate()
        try: tor.wait(timeout=10)
        except subprocess.TimeoutExpired: tor.kill(); tor.wait()

    sys.exit(failure[0] if failure else 0)
