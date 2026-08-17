#!/usr/bin/env bash
set -euo pipefail

for docker_bin in "$HOME/.docker/bin" "/usr/local/bin" "/Applications/Docker.app/Contents/Resources/bin"; do
  if [[ -x "$docker_bin/docker" ]]; then
    export PATH="$docker_bin:$PATH"
    break
  fi
done

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker CLI was not found. Run ./scripts/install-docker.sh, then open a new terminal." >&2
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  echo "Docker is not running. Open Docker Desktop and wait for the engine to start." >&2
  exit 1
fi

use_gpu=false
if [[ "$(uname -s)" != "Darwin" ]] && command -v nvidia-smi >/dev/null 2>&1; then
  echo "NVIDIA GPU found; testing Docker GPU access..."
  if docker run --rm --gpus all alpine:3.20 true; then
    use_gpu=true
  fi
fi

docker_memory="$(docker info --format '{{.MemTotal}}')"
if [[ -z "${CREW_MODEL:-}" ]]; then
  if (( docker_memory >= 14 * 1024 * 1024 * 1024 )); then
    export CREW_MODEL="gemma4:12b"
  else
    export CREW_MODEL="gemma4:e4b"
  fi
fi
echo "Using ${CREW_MODEL} with $((docker_memory / 1024 / 1024 / 1024)) GiB available to Docker."

if [[ "$use_gpu" == true ]]; then
  echo "Starting MuffinGuard with GPU acceleration."
  docker compose -f compose.yaml -f compose.gpu.yaml up --build
else
  echo "Starting MuffinGuard with CPU."
  if [[ "$(uname -s)" == "Darwin" ]]; then
    echo "Docker Desktop on macOS does not expose Apple Metal to the Ollama container."
  fi
  docker compose up --build
fi
