@echo off
rem Match product pictures from the Ski Trab catalogues to the stock and write tools\output\pictures\pictures.json
rem Run run-export.bat first (it writes the stock.json this reads). Corrections go in tools\picture-overrides.json.
cd /d "%~dp0"

where py >nul 2>nul
if %errorlevel%==0 ( set PY=py ) else ( set PY=python )

%PY% -c "import pymupdf" >nul 2>nul
if errorlevel 1 (
  echo Installing the one required package ^(PyMuPDF^)...
  %PY% -m pip install --user pymupdf
)

%PY% -W ignore extract_pictures.py
if errorlevel 1 (
  echo.
  echo The picture export did not finish. Read the message above.
  pause
  exit /b 1
)

echo.
echo Check the contact sheet if you changed anything: tools\output\pictures\contact-sheet.html
echo Then drag pictures.json onto the Admin page, tab "Pictures" (button "Choose pictures.json").
explorer /select,"%~dp0output\pictures\pictures.json"
echo.
pause
