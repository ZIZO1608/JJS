@echo off
REM JJ's ERP — run from the source folder on Windows (needs Node.js 20+).
REM First time: installs packages and builds. Then opens the app in the browser.
cd /d "%~dp0"
if not exist node_modules (
  echo Installing packages...
  call npm install || goto :error
)
if not exist dist\web\index.html (
  echo Building...
  call npm run build || goto :error
)
start "JJ's ERP server (keep this window open)" cmd /k npm start
timeout /t 4 /nobreak >nul
start "" http://127.0.0.1:4310
goto :eof
:error
echo Something went wrong. See the messages above.
pause
