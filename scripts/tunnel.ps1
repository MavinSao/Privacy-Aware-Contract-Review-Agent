#Requires -Version 5.1
<#
.SYNOPSIS
    Temporarily expose the locally-running app on a public https:// URL via a
    Cloudflare Quick Tunnel — no Cloudflare account, no DNS setup, no signup.

.DESCRIPTION
    Wraps `cloudflared tunnel --url http://localhost:<port>`. Cloudflare hands
    back a random *.trycloudflare.com URL that proxies straight to your machine
    for as long as this process runs. Closing the window (Ctrl+C) tears it down
    — nothing persists on Cloudflare's side afterward.

    This is for quick demos / letting a teammate poke at your local instance,
    not production hosting: the URL is throwaway and changes every run, and
    there is no auth in front of it — anyone with the link can reach your app
    (including the privacy chain's model calls, if you've configured external
    providers). Only run this while you intend the link to be reachable.

.PARAMETER Port
    Local port the main app is listening on. Default 8000 (matches the
    `uvicorn main:app --port 8000` command in README.md).

.EXAMPLE
    .\scripts\tunnel.ps1
    .\scripts\tunnel.ps1 -Port 8000
#>
param(
    [int]$Port = 8000
)

$cloudflared = Get-Command cloudflared -ErrorAction SilentlyContinue
if (-not $cloudflared) {
    Write-Host "cloudflared is not installed or not on PATH." -ForegroundColor Red
    Write-Host ""
    Write-Host "Install it, then re-run this script:"
    Write-Host "  winget install --id Cloudflare.cloudflared"
    Write-Host "  (or download the exe: https://github.com/cloudflare/cloudflared/releases)"
    exit 1
}

$target = "http://localhost:$Port"
Write-Host "Starting a Cloudflare Quick Tunnel -> $target" -ForegroundColor Cyan
Write-Host "Make sure 'uvicorn main:app --port $Port' is already running in another terminal." -ForegroundColor DarkGray
Write-Host "Ctrl+C to stop the tunnel. The public URL appears below once Cloudflare assigns one." -ForegroundColor DarkGray
Write-Host ""

& cloudflared tunnel --url $target
