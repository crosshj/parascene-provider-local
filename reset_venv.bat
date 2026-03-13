@echo on
setlocal EnableExtensions

cd /d "%~dp0"

REM Clear activated venv markers from current shell
set "VIRTUAL_ENV="

REM Find a python.exe that is NOT inside this repo's .venv folders
set "BASEPY="
for /f "delims=" %%I in ('where python 2^>nul') do (
  echo %%~fI | find /I "%CD%\.venv\" >nul
  if errorlevel 1 (
    echo %%~fI | find /I "%CD%\generator\.venv\" >nul
    if errorlevel 1 (
      set "BASEPY=%%~fI"
      goto :gotpython
    )
  )
)

echo No usable base Python found in PATH.
echo Close VS Code terminal, open plain Command Prompt, run: where python
goto :fail

:gotpython
echo Using base Python: %BASEPY%
"%BASEPY%" --version
if errorlevel 1 goto :fail

echo.
echo [1/6] Removing root .venv (if present)...
if exist ".venv" rmdir /s /q ".venv"

echo.
echo [2/6] Removing generator\.venv (if present)...
if exist "generator\.venv" rmdir /s /q "generator\.venv"

echo.
echo [3/6] Creating generator\.venv...
"%BASEPY%" -m venv "generator\.venv"
if errorlevel 1 goto :fail

set "PY=generator\.venv\Scripts\python.exe"
if not exist "%PY%" goto :fail

echo.
echo [4/6] Upgrading pip/setuptools/wheel...
"%PY%" -m pip install --upgrade pip setuptools wheel
if errorlevel 1 goto :fail

echo.
echo [5/6] Installing requirements...
if exist "generator\requirements.txt" (
  "%PY%" -m pip install --progress-bar on -r "generator\requirements.txt"
) else if exist "requirements.txt" (
  "%PY%" -m pip install --progress-bar on -r "requirements.txt"
) else (
  echo No requirements.txt found.
  goto :fail
)
if errorlevel 1 goto :fail

echo.
echo [6/6] Done.
goto :end

:fail
echo.
echo FAILED with error code %errorlevel%.

:end
pause
endlocal