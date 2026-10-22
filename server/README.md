# Vani voice server

Clone a voice from a short recording and have Vani read any book in it. Runs on your own
computer using [Chatterbox](https://github.com/resemble-ai/chatterbox) (MIT license). Nothing is uploaded anywhere.

**Only clone your own voice, or a voice whose owner has given you permission.**

## Windows (NVIDIA GPU recommended)

1. Install [Miniconda](https://docs.conda.io/en/latest/miniconda.html) if you don't have Anaconda.
2. Double-click `setup.bat` (one time, 5–15 minutes).
3. Double-click `start.bat`. Leave the window open while listening.
4. In Vani → **Voices** → **Your voices**, the server address is `http://localhost:8765`. Tap **Connect**, then **Record my voice**.

The first start downloads the Chatterbox model (~2 GB).

## Mac / Linux

```sh
cd server
python3.11 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python vani_voice_server.py
```

## Listening on your phone

Your phone can't reach `localhost` on your computer. Install [Tailscale](https://tailscale.com) on both, then run
`tailscale serve 8765` on the computer and use the `https://…ts.net` address it prints as the server address in Vani.

## Options

| Env var | Default | |
|---|---|---|
| `VANI_PORT` | `8765` | port |
| `VANI_HOST` | `127.0.0.1` | set `0.0.0.0` to listen on your network |
| `VANI_VOICES_DIR` | `./voices` | where voice recordings are kept |
| `VANI_PRELOAD` | `1` | load the model at startup |
