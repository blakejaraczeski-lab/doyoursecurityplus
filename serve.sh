#!/usr/bin/env bash
cd "$(dirname "$0")"
exec python3 serve.py "${1:-8777}"
