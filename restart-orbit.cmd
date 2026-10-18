@echo off
cd /d "%~dp0"
call npm run textures
call npm run app:stop
call npm run app:start
echo.
echo ORBIT restart finished. You can close this window.
pause
