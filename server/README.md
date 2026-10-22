# Vani voice server

Lets your computer do the heavy lifting for Vani, on any of your devices:

- **Kokoro on your GPU**: 27 natural voices ([Kokoro-82M](https://github.com/hexgrad/kokoro), Apache-2.0), many times faster than real time.
- **Your own voice**: clone a voice from a short recording with [Chatterbox](https://github.com/resemble-ai/chatterbox) (MIT).

Everything runs on your computer. Nothing is uploaded anywhere.

**Only clone your own voice, or a voice whose owner has given you permission.**

## Windows (NVIDIA GPU recommended)

1. Install [Miniconda](https://docs.conda.io/en/latest/miniconda.html) if you don't have Anaconda.
2. Double-click `setup.bat` (one time, 5–15 minutes).
3. Double-click `start.bat`. Leave the window open while listening.
4. In Vani → **Voices** → **Your voices**, the server address is `http://localhost:8765`. Tap **Connect**, then **Record my voice**.

The first start downloads the voice models (Kokoro ~330 MB, Chatterbox ~2 GB).

## Mac / Linux

```sh
cd server
python3.11 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python vani_voice_server.py
```

## Listening on your phone (at home or away)

Your phone can't reach `localhost` on your computer, and the Vani app needs a secure (https) address.
[Tailscale](https://tailscale.com) (free) gives you one privately — only your own devices can use it:

1. Install Tailscale on your computer and your phone, and sign in to the same account on both.
2. On the computer, open PowerShell and run: `tailscale serve --bg 8765`
3. It prints an address like `https://alex-omen.tail1234.ts.net`. In Vani on your phone → **Voices** →
   **Your voices**, paste that address and tap **Connect**.

Your computer needs to be on with `start.bat` running.

## Options

| Env var | Default | |
|---|---|---|
| `VANI_PORT` | `8765` | port |
| `VANI_HOST` | `127.0.0.1` | set `0.0.0.0` to listen on your network |
| `VANI_VOICES_DIR` | `./voices` | where voice recordings are kept |
| `VANI_PRELOAD` | `1` | load the model at startup |
