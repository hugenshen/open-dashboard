@echo off
cd /d "%~dp0"
set PORT=8765
echo Serving %CD%
echo Open: http://127.0.0.1:%PORT%/index.html
start "" "http://127.0.0.1:%PORT%/index.html"
py -m http.server %PORT% 2>nul || python -m http.server %PORT%
