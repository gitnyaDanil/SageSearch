@echo off
title SageSearch — Stopping...
echo.
echo  Stopping SageSearch Backend and Agent Services...
taskkill /f /im node.exe >nul 2>&1
taskkill /f /t /fi "WINDOWTITLE eq SageSearch Agent Brain*" >nul 2>&1
echo  SageSearch desktop stopped.
timeout /t 1 /nobreak >nul
exit
