@echo off
title SageSearch - AI File Finder & Agent
color 0A

echo.
echo  ======================================================
echo   SageSearch ^| AI File Finder ^& Autonomous Agent
echo  ======================================================
echo.

REM Check if Node.js is installed
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo  [ERROR] Node.js is not installed.
    echo  Please install Node.js from: https://nodejs.org/
    pause
    exit /b 1
)

REM Start Python Agent Service in the background
where python >nul 2>&1
if %errorlevel% equ 0 (
    echo  Starting SageSearch Agent Service (Port 8080)...
    start "SageSearch Agent Brain" /min cmd /c "cd /d "%~dp0agent-service" && python -m uvicorn api.server:app --port 8080"
) else (
    echo  [WARNING] Python not found. Agent Service will not start locally.
)

REM Check if backend dependencies are installed
if not exist "%~dp0backend\node_modules" (
    echo  Installing backend dependencies...
    cd /d "%~dp0backend"
    call npm install
)

REM Start the backend server
cd /d "%~dp0backend"
echo  Starting SageSearch desktop backend (Port 3001)...
echo.
echo  Opening http://localhost:3001 in your default browser...
echo.

start "" cmd /c "timeout /t 2 /nobreak >nul && start http://localhost:3001"

node server.js

echo.
echo  SageSearch backend has stopped.
pause
