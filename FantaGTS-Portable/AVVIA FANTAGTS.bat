@echo off 
 
echo ===================================== 
echo    FANTAGTS - FANTASY TENNIS 
echo      Versione Portable - Ready to Play 
echo ===================================== 
echo. 
cd /d "%~dp0app" 
echo Avviando il server... 
echo. 
echo Apri nel browser: 
echo    http://localhost:3000 
echo. 
echo Per fermare: premi CTRL+C 
echo. 
"%~dp0nodejs\node.exe" server.js 
pause 
