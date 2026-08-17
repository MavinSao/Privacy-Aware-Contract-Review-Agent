#Requires -Version 5.1
$ErrorActionPreference = "Stop"

docker info *> $null
if ($LASTEXITCODE -ne 0) {
    throw "Docker is not running. Open Docker Desktop and wait for the engine to start."
}

$useGpu = $false
if (Get-Command nvidia-smi -ErrorAction SilentlyContinue) {
    Write-Host "NVIDIA GPU found; testing Docker GPU access..." -ForegroundColor Cyan
    docker run --rm --gpus all alpine:3.20 true
    $useGpu = $LASTEXITCODE -eq 0
}

[int64]$dockerMemory = docker info --format '{{.MemTotal}}'
if (-not $env:CREW_MODEL) {
    if ($dockerMemory -ge 14GB) {
        $env:CREW_MODEL = "gemma4:12b"
    } else {
        $env:CREW_MODEL = "gemma4:e4b"
    }
}
Write-Host "Using $env:CREW_MODEL with $([math]::Round($dockerMemory / 1GB, 1)) GiB available to Docker." -ForegroundColor Cyan

if ($useGpu) {
    Write-Host "Starting MuffinGuard with GPU acceleration." -ForegroundColor Green
    docker compose -f compose.yaml -f compose.gpu.yaml up --build
} else {
    Write-Host "Compatible Docker GPU access was not found; starting with CPU." -ForegroundColor Yellow
    docker compose up --build
}
