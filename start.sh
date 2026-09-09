#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")"
if ! docker info >/dev/null 2>&1; then
  echo 'Start Docker and run this script again.'
  exit 1
fi
if [ ! -f .env ]; then
  umask 077
  secret=$(od -An -N32 -tx1 /dev/urandom | tr -d ' \n')
  printf 'SEARXNG_SECRET=%s\n' "$secret" > .env
fi
docker compose down
docker compose up --build -d
if ! docker compose exec -T app python /app/network_check.py; then
  docker compose down
  exit 1
fi
if ! docker compose exec -T searxng python3 /opt/veil-network-check.py; then
  docker compose down
  exit 1
fi
printf '\nOpen http://127.0.0.1:8787 in your browser. Tor startup can take a few minutes. Click Check Tor connection. Click results to read pages inside Hoyahh.\nStop with: docker compose down\n'
