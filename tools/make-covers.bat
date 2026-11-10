@echo off
rem Make a cover image (first page) next to every catalog PDF in "Sharable info\Documents".
rem Then, in the portal Admin page (Documents tab), choose the .cover.jpg when you add each catalog.
cd /d "%~dp0"

where py >nul 2>nul
if %errorlevel%==0 ( set PY=py ) else ( set PY=python )

%PY% -c "import fitz" >nul 2>nul
if errorlevel 1 (
  echo Installing the one required package ^(PyMuPDF^)...
  %PY% -m pip install --user pymupdf
)

%PY% make_covers.py %*
echo.
pause
