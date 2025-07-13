@echo off
SETLOCAL EnableDelayedExpansion

echo === Starting MCP FileScopeMCP Setup ===

:: Check for Node.js and npm
where node >nul 2>&1
if errorlevel 1 (
    echo ERROR: Node.js not found in PATH. Please install from https://nodejs.org/
    pause
    exit /b 1
) else (
    for /f "tokens=*" %%i in ('where node') do set "NODE_EXE=%%i"
    echo --- Using Node.js from: "!NODE_EXE!"
)

where npm >nul 2>&1
if errorlevel 1 (
    echo ERROR: npm not found in PATH. Reinstall Node.js from https://nodejs.org/ or ensure npm is installed.
    pause
    exit /b 1
) else (
    for /f "tokens=*" %%i in ('where npm') do set "NPM_CMD=%%i"
    echo --- Using npm from: "!NPM_CMD!"
)

:: Add Node.js directory to PATH (if needed)
for %%F in ("!NODE_EXE!") do set "NODE_DIR=%%~dpF"
node --version >nul 2>&1
if errorlevel 1 (
    set "PATH=!NODE_DIR!;%PATH%"
    echo --- Added Node.js directory to PATH
)

:: Install dependencies
echo.
echo --- Installing dependencies...
call "!NPM_CMD!" install
if errorlevel 1 (
    echo ERROR: Failed to install dependencies. Check Node.js installation or run with elevated privileges.
    pause
    exit /b 1
)

echo.
echo --- Ensuring TypeScript is installed...
npm install typescript
if errorlevel 1 (
    echo ERROR: Failed to install TypeScript.
    pause
    exit /b 1
)

echo.
echo --- Building TypeScript...
if exist dist (
    echo --- Cleaning dist directory...
    rmdir /s /q dist
    if errorlevel 1 (
        echo ERROR: Failed to clean dist directory.
        pause
        exit /b 1
    )
)

if exist "node_modules\typescript\bin\tsc.js" (
    echo --- Found tsc.js, running build...
    "!NODE_EXE!" "node_modules\typescript\bin\tsc.js"
    if errorlevel 1 (
        echo ERROR: Build failed. Check tsconfig.json or TypeScript output above for details.
        pause
        exit /b 1
)
) else (
    echo --- Falling back to npx tsc...
    call "!NPM_CMD!" exec -- tsc -p tsconfig.json
    if errorlevel 1 (
        echo ERROR: Build failed with npx. Check tsconfig.json or TypeScript output above for details.
        pause
        exit /b 1
    )
)

echo.
echo --- Generating MCP configuration...
set "PROJECT_ROOT=%CD%"
set "PARENT_DIR=%PROJECT_ROOT%\.."
for /f "delims=" %%i in ("%PARENT_DIR%") do set "PARENT_DIR=%%~fi"

set "TEMPLATE_FILE=mcp.json.win.txt"
if not exist "!TEMPLATE_FILE!" (
    echo ERROR: !TEMPLATE_FILE! not found.
    pause
    exit /b 1
)

set "MCP_CONTENT="
for /f "usebackq delims=" %%L in ("!TEMPLATE_FILE!") do (
    set "LINE=%%L"
    set "LINE=!LINE:{projectRoot}=%PARENT_DIR%!"
    set "MCP_CONTENT=!MCP_CONTENT!!LINE!"
)

echo !MCP_CONTENT! > mcp.json

echo.
echo --- Creating run.bat...
(echo @echo off)
(echo."!NODE_EXE!" "%PROJECT_ROOT%\dist\mcp-server.js" --base-dir="%PARENT_DIR%") > run.bat

echo.
echo === Setup Complete ===
echo --- MCP configuration generated at ./mcp.json
echo --- run.bat created.
echo --- Project root: %PROJECT_ROOT%
echo.
echo To integrate with Cursor AI:
echo 1. Create a ".cursor" folder in your project root (%PARENT_DIR%) if it doesn't exist.
echo 2. Copy mcp.json to the .cursor folder to enable MCP server integration.
echo.
echo Or run the server manually with run.bat

pause
ENDLOCAL