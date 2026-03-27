@echo off
chcp 65001 >nul
setlocal

cd /d "%~dp0"
set PYTHONUTF8=1
set NO_COLOR=1

if exist ".env.local.bat" call ".env.local.bat"

where conda >nul 2>&1
if errorlevel 1 (
    echo [ERROR] conda command not found. Please install Anaconda/Miniconda.
    pause
    exit /b 1
)

call conda run --no-capture-output -n video-ai python -c "import sys" >nul 2>&1
if errorlevel 1 (
    echo [ERROR] conda env 'video-ai' is not available.
    echo         Please create it first, then install requirements.
    pause
    exit /b 1
)

echo [INFO] Using conda env: video-ai

set "PORT_PID="
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":8000" ^| findstr "LISTENING"') do (
    set "PORT_PID=%%p"
    goto :port_check_done
)
:port_check_done
if defined PORT_PID (
    echo [ERROR] Port 8000 is already in use. PID=%PORT_PID%
    echo         Please close the existing process first, then restart.
    pause
    exit /b 1
)

call conda run --no-capture-output -n video-ai python main.py

if errorlevel 1 (
    echo.
    echo [ERROR] Service exited unexpectedly.
    pause
    exit /b 1
)
