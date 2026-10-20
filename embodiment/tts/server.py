"""Tiny local Piper TTS server. Loads the voice once, then POST /tts {"text": "..."} -> audio/wav.

Usage: .venv/bin/python server.py <port> <voice.onnx> [length_scale]
"""
import io
import json
import os
import sys
import threading
import time
import wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from piper import PiperVoice, SynthesisConfig

port = int(sys.argv[1])
voice = PiperVoice.load(sys.argv[2])
config = SynthesisConfig(length_scale=float(sys.argv[3]) if len(sys.argv) > 3 else None)
lock = threading.Lock()


def synth(text):
    buf = io.BytesIO()
    with lock, wave.open(buf, "wb") as wav:
        voice.synthesize_wav(text, wav, syn_config=config)
    return buf.getvalue()


class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        text = json.loads(self.rfile.read(int(self.headers["Content-Length"])))["text"]
        t0 = time.time()
        audio = synth(text)
        self.send_response(200)
        self.send_header("Content-Type", "audio/wav")
        self.send_header("Content-Length", str(len(audio)))
        self.send_header("X-Synth-Ms", str(round((time.time() - t0) * 1000)))
        self.end_headers()
        self.wfile.write(audio)

    def log_message(self, *args):
        pass


def exit_with_parent():
    sys.stdin.read()  # returns when the app that started us goes away, however it ends
    os._exit(0)


threading.Thread(target=exit_with_parent, daemon=True).start()
synth("Warming up.")  # first call is slow
print(f"piper ready on {port}", flush=True)
ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
