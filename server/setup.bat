@echo off
setlocal
cd /d "%~dp0"
title Vani voice server setup
echo.
echo  Setting up the Vani voice server (Chatterbox voice cloning)...
echo  This downloads about 3-4 GB and takes 5-15 minutes. One time only.
echo.

set "CONDA=conda"
where conda >nul 2>nul
if errorlevel 1 set "CONDA=%USERPROFILE%\anaconda3\condabin\conda.bat"
if not exist "%CONDA%" if not "%CONDA%"=="conda" (
  if exist "%USERPROFILE%\miniconda3\condabin\conda.bat" (set "CONDA=%USERPROFILE%\miniconda3\condabin\conda.bat") else (
    echo Could not find Anaconda or Miniconda. Install Miniconda from https://docs.conda.io and run this again.
    pause & exit /b 1
  )
)

if not exist ".venv\python.exe" (
  call "%CONDA%" create -y -p "%~dp0.venv" python=3.11 || (echo Conda environment failed. & pause & exit /b 1)
)
set "PY=%~dp0.venv\python.exe"

"%PY%" -m pip install --upgrade pip
"%PY%" -m pip install -r requirements.txt || (echo Package install failed. & pause & exit /b 1)
"%PY%" install_cuda_torch.py

echo.
echo  Done! Double-click start.bat to run the voice server.
echo.
pause
