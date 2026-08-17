#!/usr/bin/env bash
set -euo pipefail

if command -v docker >/dev/null 2>&1; then
  echo "Docker is already installed."
elif command -v brew >/dev/null 2>&1; then
  echo "Installing Docker Desktop with Homebrew..."
  brew install --cask docker
else
  echo "Homebrew is required for automatic installation." >&2
  echo "Install it from https://brew.sh or download Docker Desktop from:" >&2
  echo "https://www.docker.com/products/docker-desktop/" >&2
  exit 1
fi

open -a Docker
echo "Docker Desktop is starting. Wait until it reports that Docker is running."
echo "Next: docker compose up --build"
