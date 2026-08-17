#Requires -Version 5.1
$ErrorActionPreference = "Stop"
$dockerBin = Join-Path $env:ProgramFiles "Docker\Docker\resources\bin"
if (-not (Get-Command docker -ErrorAction SilentlyContinue) -and
    (Test-Path -LiteralPath (Join-Path $dockerBin "docker.exe"))) {
    $env:Path = "$dockerBin;$env:Path"
}

if (Get-Command docker -ErrorAction SilentlyContinue) {
    Write-Host "Docker is already installed." -ForegroundColor Green
} else {
    if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
        throw "winget is required. Install Docker Desktop manually from https://www.docker.com/products/docker-desktop/"
    }

    Write-Host "Installing Docker Desktop with winget..." -ForegroundColor Cyan
    winget install --exact --id Docker.DockerDesktop --accept-source-agreements --accept-package-agreements
    if ($LASTEXITCODE -ne 0) {
        throw "Docker Desktop installation failed with exit code $LASTEXITCODE."
    }
}

if (Test-Path -LiteralPath (Join-Path $dockerBin "docker.exe")) {
    $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
    if (($userPath -split ";") -notcontains $dockerBin) {
        [Environment]::SetEnvironmentVariable("Path", "$userPath;$dockerBin".TrimStart(";"), "User")
    }
    $env:Path = "$dockerBin;$env:Path"
}

$dockerDesktop = Join-Path $env:ProgramFiles "Docker\Docker\Docker Desktop.exe"
if (Test-Path -LiteralPath $dockerDesktop) {
    Start-Process -FilePath $dockerDesktop
    Write-Host "Docker Desktop is starting. Wait until it reports that Docker is running." -ForegroundColor Yellow
} else {
    Write-Host "Open Docker Desktop, then wait until Docker is running." -ForegroundColor Yellow
}

Write-Host "Next: powershell -ExecutionPolicy Bypass -File .\scripts\start.ps1" -ForegroundColor Green
