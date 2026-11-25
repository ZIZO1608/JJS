@echo off
REM JJ's ERP - one-click setup for the shop laptop.
REM Installs the shop server and the app, makes the shop start with Windows, then opens the app.
REM Running it again updates to the new version: the shop's data is never touched.
setlocal
cd /d "%~dp0"
title JJ's ERP setup
echo.
echo  ==============================================
echo    JJ's ERP - setup
echo  ==============================================
echo.
if not exist "1-JJs-ERP-Server-Setup.exe" goto :missing
if not exist "2-JJs-ERP-Setup.exe" goto :missing

echo [1/4] Closing JJ's ERP if it is open...
taskkill /im "JJ's ERP.exe" /f >nul 2>&1
taskkill /im "JJ's ERP Server.exe" /f >nul 2>&1
timeout /t 2 /nobreak >nul

echo [2/4] Installing the shop server...
start "" /wait "1-JJs-ERP-Server-Setup.exe" /S
if errorlevel 1 goto :failed

echo [3/4] Installing the JJ's ERP app...
start "" /wait "2-JJs-ERP-Setup.exe" /S
if errorlevel 1 goto :failed

set "SERVER=%LOCALAPPDATA%\Programs\jjs-erp-server\JJ's ERP Server.exe"
set "APP=%LOCALAPPDATA%\Programs\jjs-erp\JJ's ERP.exe"
if not exist "%SERVER%" goto :failed
if not exist "%APP%" goto :failed

echo [4/4] Starting the shop (it will now start by itself with Windows)...
start "" "%SERVER%" --start-with-windows
timeout /t 8 /nobreak >nul
start "" "%APP%"

echo.
echo  Done. JJ's ERP is open, and there is a shortcut on the desktop.
echo.
echo  Next: open the "READ ME" file in this folder for the first-day steps (printer, users, rate).
echo.
pause
exit /b 0

:missing
echo The setup files are missing. Keep this file in the same folder as
echo "1-JJs-ERP-Server-Setup.exe" and "2-JJs-ERP-Setup.exe".
pause
exit /b 1

:failed
echo.
echo Setup did not finish. Restart the laptop and run this file again.
echo If it still fails, WhatsApp support: +963 942 556 404
pause
exit /b 1
