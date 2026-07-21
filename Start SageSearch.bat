@echo off
title SageSearch
color 0A

echo.
echo  ==========================================
echo   SageSearch ^| AI File Finder
echo  ==========================================
echo.

REM Check if Node.js is installed
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo  [ERROR] Node.js is not installed.
    echo.
    echo  Please install Node.js from: https://nodejs.org/
    echo.
    pause
    exit /b 1
)

REM SQLite indexing uses Node's built-in SQLite module (available in Node 22.5+)
node -e "const [major,minor]=process.versions.node.split('.').map(Number);process.exit(major>22||(major===22&&minor>=5)?0:1)" >nul 2>&1
if %errorlevel% neq 0 (
    echo  [ERROR] SageSearch now requires Node.js 22.5 or newer.
    echo.
    echo  Please update Node.js from: https://nodejs.org/
    echo.
    pause
    exit /b 1
)

REM Check if dependencies are installed
if not exist "%~dp0backend\node_modules" (
    echo  Installing dependencies for the first time...
    echo  This only happens once.
    echo.
    cd /d "%~dp0backend"
    call npm install
    if %errorlevel% neq 0 (
        echo.
        echo  [ERROR] Failed to install dependencies.
        pause
        exit /b 1
    )
    echo.
    echo  Done! Starting SageSearch...
    echo.
)

REM Start the backend server
cd /d "%~dp0backend"
echo  Starting SageSearch backend...
echo.
echo  Once started, your browser will open automatically.
echo  To stop SageSearch, close this window.
echo.

REM Open browser after a short delay (2 seconds for server to start)
start "" cmd /c "timeout /t 2 /nobreak >nul && start http://localhost:3001"

REM Start the server (this keeps the window open)
node server.js

echo.
echo  SageSearch has stopped.
pause
