#!/usr/bin/env bash
set -euo pipefail

pkill -x gammastep 2>/dev/null || true
exec gammastep
