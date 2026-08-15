#!/usr/bin/env bash
# Temporarily expose the locally-running app on a public https:// URL via a
# Cloudflare Quick Tunnel — no Cloudflare account, no DNS setup, no signup.
#
# Wraps `cloudflared tunnel --url http://localhost:<port>`. Cloudflare hands
# back a random *.trycloudflare.com URL that proxies straight to your machine
# for as long as this process runs. Ctrl+C tears it down — nothing persists
# on Cloudflare's side afterward.
#
# This is for quick demos / letting a teammate poke at your local instance,
# not production hosting: the URL is throwaway and changes every run, and
# there is no auth in front of it — anyone with the link can reach your app.
# Only run this while you intend the link to be reachable.
#
# Usage:
#   ./scripts/tunnel.sh          # port 8000 (matches README's uvicorn command)
#   ./scripts/tunnel.sh 8000

set -euo pipefail

PORT="${1:-8000}"

if ! command -v cloudflared >/dev/null 2>&1; then
    echo "cloudflared is not installed or not on PATH." >&2
    echo "" >&2
    echo "Install it, then re-run this script:" >&2
    echo "  macOS:   brew install cloudflared" >&2
    echo "  Linux:   see https://github.com/cloudflare/cloudflared/releases" >&2
    exit 1
fi

echo "Starting a Cloudflare Quick Tunnel -> http://localhost:${PORT}"
echo "Make sure 'uvicorn main:app --port ${PORT}' is already running in another terminal."
echo "Ctrl+C to stop the tunnel. The public URL appears below once Cloudflare assigns one."
echo ""

exec cloudflared tunnel --url "http://localhost:${PORT}"