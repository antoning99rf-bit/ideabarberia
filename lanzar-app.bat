@echo off
cd /d "%~dp0"

set "NODE_EXE=C:\Users\anton\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"

if not exist "%NODE_EXE%" (
  set "NODE_EXE=C:\Program Files\WindowsApps\OpenAI.Codex_26.506.3741.0_x64__2p2nqsd0c76g0\app\resources\node.exe"
)

if not exist "%NODE_EXE%" (
  echo No se encontro Node.js en este equipo.
  echo Instala Node.js LTS desde https://nodejs.org/ y vuelve a abrir este archivo.
  pause
  exit /b 1
)

for %%I in ("%NODE_EXE%") do set "NODE_DIR=%%~dpI"
set "PATH=%NODE_DIR%;%PATH%"

if not exist ".tools\package\bin\npm-cli.js" (
  echo No se encontro npm portable en .tools.
  echo Falta el npm portable que se preparo para este proyecto.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo Instalando dependencias...
  "%NODE_EXE%" .tools\package\bin\npm-cli.js install
  if errorlevel 1 (
    echo No se pudieron instalar las dependencias.
    pause
    exit /b 1
  )
)

if exist ".next" (
  echo Limpiando cache de Next...
  rmdir /s /q ".next"
)

echo.
echo Aplicacion iniciandose...
echo Abre http://localhost:3000
echo Panel privado: http://localhost:3000/admin
echo.

"%NODE_EXE%" .tools\package\bin\npm-cli.js run dev
pause
