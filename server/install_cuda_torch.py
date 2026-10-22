"""Swap the CPU-only PyTorch that pip installs on Windows for the NVIDIA (CUDA) build,
keeping the exact version Chatterbox asked for. Skips quietly if there's no NVIDIA GPU."""
import shutil
import subprocess
import sys

if not shutil.which("nvidia-smi"):
    print("No NVIDIA GPU detected — staying on CPU (slower, but works).")
    sys.exit(0)

import torch  # noqa: E402

if torch.cuda.is_available():
    print(f"PyTorch {torch.__version__} already uses your GPU: {torch.cuda.get_device_name(0)}")
    sys.exit(0)

import torchaudio  # noqa: E402

tv = torch.__version__.split("+")[0]
av = torchaudio.__version__.split("+")[0]
for cu in ("cu128", "cu126", "cu124", "cu121"):
    print(f"Installing GPU PyTorch {tv} ({cu})…")
    r = subprocess.run([sys.executable, "-m", "pip", "install", "--force-reinstall", "--no-deps",
                        f"torch=={tv}", f"torchaudio=={av}", "--index-url", f"https://download.pytorch.org/whl/{cu}"])
    if r.returncode == 0:
        check = subprocess.run([sys.executable, "-c", "import torch;print(torch.cuda.is_available())"], capture_output=True, text=True)
        if check.stdout.strip() == "True":
            print("GPU acceleration is on.")
            sys.exit(0)
print("Couldn't enable GPU acceleration automatically; the server will run on CPU.")
