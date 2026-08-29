@echo off
setlocal
title SageSearch - AI File Finder ^& Agent
color 0A

set "ROOT=%~dp0"

echo.
echo  ======================================================
echo   SageSearch ^| AI File Finder ^& Autonomous Agent
echo  ======================================================
echo.

REM Check if Node.js is installed
where node >nul 2>&1
if errorlevel 1 goto node_missing

REM Start Python Agent Service in the background
python --version >nul 2>&1
if errorlevel 1 goto python_missing
echo  Starting SageSearch Agent Service (Port 8080)...
start "SageSearch Agent Brain" /min /D "%ROOT%agent-service" python -m uvicorn api.server:app --host 127.0.0.1 --port 8080
set "AGENT_WAIT=0"

:wait_for_agent
powershell.exe -NoProfile -Command "$ProgressPreference='SilentlyContinue'; try { Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:8080/health' -TimeoutSec 1 | Out-Null; exit 0 } catch { exit 1 }" >nul 2>&1
if not errorlevel 1 goto backend_check
set /a AGENT_WAIT+=1 >nul
if %AGENT_WAIT% geq 30 goto agent_not_ready
timeout /t 1 /nobreak >nul
goto wait_for_agent

:python_missing
echo  [WARNING] Python not found. Agent Service will not start locally.
goto backend_check

:agent_not_ready
echo  [WARNING] Agent Service did not become ready within 30 seconds.

REM Check if backend dependencies are installed
:backend_check
if exist "%ROOT%backend\node_modules" goto backend_ready
echo  Installing backend dependencies...
cd /d "%ROOT%backend"
call npm install

REM Start the backend server
:backend_ready
cd /d "%ROOT%backend"
echo  Starting SageSearch desktop backend (Port 3001)...
echo.
echo  Opening http://localhost:3001 in your default browser...
echo.

start "" /b cmd /c "timeout /t 2 /nobreak >nul && start http://localhost:3001"

node server.js

echo.
echo  SageSearch backend has stopped.
pause
exit /b 0

:node_missing
echo  [ERROR] Node.js is not installed.
echo  Please install Node.js from: https://nodejs.org/
pause
exit /b 1
