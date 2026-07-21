@echo off
title SageSearch — Stopping...
echo.
echo  Stopping SageSearch...
taskkill /f /im node.exe >nul 2>&1
echo  SageSearch stopped.
echo.
timeout /t 2 /nobreak >nul
