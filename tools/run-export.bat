@echo off
rem Export the sellable stock from the M workbook to tools\output\stock.json
rem Before running: open the workbook in Excel, refresh the Stock sheet, SAVE and close it.
rem First run only: copy local-config.example.json to local-config.json and set the workbook path.
cd /d "%~dp0"

where py >nul 2>nul
if %errorlevel%==0 ( set PY=py ) else ( set PY=python )

%PY% -c "import openpyxl" >nul 2>nul
if errorlevel 1 (
  echo Installing the one required package ^(openpyxl^)...
  %PY% -m pip install --user -r requirements.txt
)

%PY% export_stock.py
if errorlevel 1 (
  echo.
  echo The export did not finish. Read the message above.
  pause
  exit /b 1
)

echo.
echo Opening the folder with stock.json selected.
echo Drag it onto the box in the portal Admin page, tab "Stock upload", or use "Choose file".
explorer /select,"%~dp0output\stock.json"
echo.
pause
