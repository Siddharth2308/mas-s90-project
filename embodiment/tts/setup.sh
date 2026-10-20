#!/usr/bin/env bash
# One-time setup for the local Piper voice (about 70 MB). Run from anywhere.
set -e
cd "$(dirname "$0")"
python3 -m venv .venv
.venv/bin/pip install -q piper-tts
mkdir -p voices
.venv/bin/python -m piper.download_voices --download-dir voices "${1:-en_US-ryan-medium}"
echo "Piper voice ready. Start the app with: npm run dev"
