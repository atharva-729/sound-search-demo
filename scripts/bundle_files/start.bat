@echo off
rem Sound Search: full version with typed search.
rem First run: sets up Python and its packages by itself (about 1 GB download, 5-10 minutes, needs internet once).
rem Later runs start in seconds. Add --lan to let others on the same network open it:  start.bat --lan
cd /d "%~dp0search"
set UV_NATIVE_TLS=1
set UV_PYTHON_PREFERENCE=only-managed
if not exist ".venv\Scripts\python.exe" (
  echo.
  echo   First run: setting up Python and the search models' packages. This takes 5-10 minutes, once.
  echo.
  uv.exe venv --python 3.12 .venv || goto :fail
  uv.exe pip install --python .venv\Scripts\python.exe -r requirements.txt || goto :fail
)
".venv\Scripts\python.exe" server.py %*
goto :eof
:fail
echo.
echo   Setup failed (often a network block). You can still double-click web\index.html:
echo   everything works there except typed search.
pause
