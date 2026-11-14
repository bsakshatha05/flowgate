@echo off
REM Double-click this file to start FlowGate on Windows.
cd /d "%~dp0"

echo.
echo   ===============================
echo     Starting FlowGate...
echo   ===============================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo   PROBLEM: Node is not installed on this computer.
  echo.
  echo   How to fix it:
  echo     1. Go to  https://nodejs.org
  echo     2. Click the big green button on the left ^(it says LTS^).
  echo     3. Open the file that downloads and click Next until it finishes.
  echo     4. Restart the computer.
  echo     5. Double-click this file again.
  echo.
  pause
  exit /b 1
)

REM Open the web page a few seconds after the server starts.
REM ping is used as a simple wait because it works in every Windows console.
start /b cmd /c "ping -n 5 127.0.0.1 >nul && start http://localhost:4000"

echo   Your browser will open in a few seconds.
echo   If it does not, type this into your browser:  http://localhost:4000
echo.
echo   KEEP THIS WINDOW OPEN while you use FlowGate.
echo   To stop: click this window and press Control and C.
echo.

node server.js --reset

echo.
echo   FlowGate has stopped.
pause
