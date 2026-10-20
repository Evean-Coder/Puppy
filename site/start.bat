@echo off
setlocal
cd /d "%~dp0"
title course page - local server

where py >nul 2>nul
if not errorlevel 1 goto usepy
where python >nul 2>nul
if not errorlevel 1 goto usepython

echo.
echo  Python 3 was not found on PATH.
echo  Install it from https://www.python.org/downloads/  (tick "Add python.exe to PATH")
echo  Or just double-click index.html - the page still opens, but video seeking may be limited.
echo.
pause
exit /b 1

:usepy
py -3 serve.py 8123
goto done

:usepython
python serve.py 8123

:done
if errorlevel 1 pause
