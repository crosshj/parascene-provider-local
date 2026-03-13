@echo off
setlocal

cd /d "%~dp0"

echo [1/4] Removing old virtual environments...
if exist ".venv" rmdir /s /q ".venv"
if exist "generator\.venv" rmdir /s /q "generator\.venv"

echo [2/4] Creating new generator\.venv...
py -3 -m venv "generator\.venv" 2>nul
if errorlevel 1 (
  if exist ".venv\Scripts\python.exe" (
    ".venv\Scripts\python.exe" -m venv "generator\.venv"
  ) else (
    python -m venv "generator\.venv"
  )
)
if errorlevel 1 (
  echo Failed to create virtual environment.
  exit /b 1
)

echo [3/4] Upgrading pip...
"generator\.venv\Scripts\python.exe" -m pip install --upgrade pip
if errorlevel 1 exit /b 1

echo [4/4] Installing dependencies...
if exist "generator\requirements.txt" (
  "generator\.venv\Scripts\python.exe" -m pip install -r "generator\requirements.txt"
) else (
  "generator\.venv\Scripts\python.exe" -m pip install -r "requirements.txt"
)
if errorlevel 1 exit /b 1

echo Done. To activate in cmd.exe, run:
echo call generator\.venv\Scripts\activate.bat
