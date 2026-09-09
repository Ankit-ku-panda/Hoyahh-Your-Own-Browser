"""Startup smoke checks for the supplied Docker network, without search queries.
These probes detect common misconfiguration; they are not a formal leak audit.
"""
import socket
import sys
import threading

failures = []
# Docker's internal service DNS must work, while external DNS must not.
try:
    socket.getaddrinfo('tor', 9050)
except OSError:
    failures.append('Cannot resolve internal Tor service.')
for address in ('1.1.1.1', '8.8.8.8'):
    try:
        with socket.create_connection((address, 443), timeout=5):
            failures.append('Direct internet connection succeeded. Isolation is not working.')
    except OSError:
        pass
external_answer = []
finished = threading.Event()
def resolve():
    try:
        external_answer.extend(socket.getaddrinfo('example.com', 443))
    except OSError:
        pass
    finally:
        finished.set()
threading.Thread(target=resolve, daemon=True).start()
if not finished.wait(8):
    failures.append('External DNS test did not finish; cannot confirm isolation.')
elif external_answer:
    failures.append('External DNS resolution succeeded outside the Tor proxy.')
if failures:
    for message in failures: print(message)
    print('Isolation check failed. Do not search until this is resolved.')
    sys.exit(1)
print('Direct TCP and external DNS probes blocked; internal Tor service DNS available.')
