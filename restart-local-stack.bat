@echo off
setlocal ENABLEDELAYEDEXPANSION

set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"

set "PY_SERVICE_PORT=5100"
set "BACKEND_PORT=4000"
set "FRONTEND_PORT=5173"
set "STUDYTOOLS_SERVICE_URL=http://localhost:%PY_SERVICE_PORT%"
set "PYTHON_EXE=%ROOT%\.venv-studytools\Scripts\python.exe"
set "PYTHON_APP=%ROOT%\studytools-service\app.py"
set "BACKEND_DIR=%ROOT%\backend"
set "FRONTEND_DIR=%ROOT%\frontend\mcq-ui"

if not exist "%PYTHON_EXE%" (
  echo [ERROR] Python venv not found: %PYTHON_EXE%
  pause
  exit /b 1
)

if not exist "%PYTHON_APP%" (
  echo [ERROR] Study tools service not found: %PYTHON_APP%
  pause
  exit /b 1
)

if not exist "%BACKEND_DIR%\package.json" (
  echo [ERROR] Backend package.json not found.
  pause
  exit /b 1
)

if not exist "%FRONTEND_DIR%\package.json" (
  echo [ERROR] Frontend package.json not found.
  pause
  exit /b 1
)

echo.
echo ==========================================
echo AI-MCQ Local Stack Restart
echo ==========================================
echo.
set /p STUDYTOOLS_SERVICE_TOKEN=Enter STUDYTOOLS_SERVICE_TOKEN: 
if "%STUDYTOOLS_SERVICE_TOKEN%"=="" (
  echo [ERROR] STUDYTOOLS_SERVICE_TOKEN is required.
  pause
  exit /b 1
)

echo.
echo Stopping existing dev terminals and listeners...
for %%T in ("AI-MCQ Python Service" "AI-MCQ Backend API" "AI-MCQ Study Worker" "AI-MCQ Frontend") do (
  taskkill /FI "WINDOWTITLE eq %%~T" /T /F >nul 2>&1
)
for %%P in (%PY_SERVICE_PORT% %BACKEND_PORT% %FRONTEND_PORT%) do (
  for /f "tokens=5" %%I in ('netstat -ano ^| findstr :%%P ^| findstr LISTENING') do (
    taskkill /PID %%I /T /F >nul 2>&1
  )
)

echo Starting Python Study Tools service...
start "AI-MCQ Python Service" cmd /k "cd /d "%ROOT%" && set STUDYTOOLS_SERVICE_TOKEN=%STUDYTOOLS_SERVICE_TOKEN% && "%PYTHON_EXE%" "%PYTHON_APP%""

timeout /t 2 /nobreak >nul

echo Starting backend API...
start "AI-MCQ Backend API" cmd /k "cd /d "%BACKEND_DIR%" && set STUDYTOOLS_SERVICE_URL=%STUDYTOOLS_SERVICE_URL% && set STUDYTOOLS_SERVICE_TOKEN=%STUDYTOOLS_SERVICE_TOKEN% && npm run dev"

timeout /t 2 /nobreak >nul

echo Starting Study Tools worker...
start "AI-MCQ Study Worker" cmd /k "cd /d "%BACKEND_DIR%" && set STUDYTOOLS_SERVICE_URL=%STUDYTOOLS_SERVICE_URL% && set STUDYTOOLS_SERVICE_TOKEN=%STUDYTOOLS_SERVICE_TOKEN% && npm run study-materials-worker"

timeout /t 2 /nobreak >nul

echo Starting frontend...
start "AI-MCQ Frontend" cmd /k "cd /d "%FRONTEND_DIR%" && npm run dev"

echo.
echo Started:
echo - Python service: %STUDYTOOLS_SERVICE_URL%
echo - Backend API: localhost:%BACKEND_PORT%
echo - Frontend: localhost:%FRONTEND_PORT%
echo.
echo Use the titled terminals to inspect logs.
pause
endlocal
