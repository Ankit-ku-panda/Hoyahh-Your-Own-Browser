"""Fixed-destination TCP relay for Windows -> isolated Veil app.

This container has a published port. It cannot choose destinations from requests
and never forwards connections anywhere except the internal app service.
"""
import os
import select
import socket
import socketserver
import threading

TARGET = ('app', 8787)
SLOTS = threading.BoundedSemaphore(32)

def relay(client, upstream, idle_timeout=95):
    client.settimeout(10)
    upstream.settimeout(10)
    while True:
        readable, _, _ = select.select([client, upstream], [], [], idle_timeout)
        if not readable:
            return
        for source in readable:
            block = source.recv(65536)
            if not block:
                return
            destination = upstream if source is client else client
            destination.sendall(block)

class Handler(socketserver.BaseRequestHandler):
    def handle(self):
        if not SLOTS.acquire(blocking=False):
            return
        try:
            with socket.create_connection(TARGET, timeout=5) as upstream:
                relay(self.request, upstream)
        except (OSError, ValueError):
            pass
        finally:
            SLOTS.release()

class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True
    def handle_error(self, request, client_address):
        pass

if __name__ == '__main__':
    Server(('0.0.0.0', 8787), Handler).serve_forever()
