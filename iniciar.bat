@echo off
title Lara Leads Chat Sandbox Launcher
echo =======================================================
echo     LARA LEADS CHAT SANDBOX DEVELOPER RUNNER
echo =======================================================
echo.

:: Test Node.js by requesting version
node -v >nul 2>&1
if %errorlevel% equ 0 (
    echo [INFO] Node.js detectado e operacional!
    echo [INFO] Iniciando o servidor Node.js local na porta 3000...
    echo.
    start http://localhost:3000
    node server.js
    goto end
)

:: No Node.js runtime found, fall back to opening index.html directly
echo.
echo [AVISO] Nenhum runtime do Node.js funcional foi encontrado.
echo [AVISO] Abrindo o chat diretamente no seu navegador no modo Simulador...
echo.
start index.html

:end
pause
