@echo off
SETLOCAL EnableDelayedExpansion

echo === Starting MCP FileScopeMCP Setup ===

:: Check for Node.js and npm
where node >nul 2>&1
if errorlevel 1 (
    echo ERROR: Node.js not found in PATH. Please install from https://nodejs.org/
    exit /b 1
) else (
    for /f "tokens=*" %%i in ('where node') do set "NODE_EXE=%%i"
    echo --- Using Node.js from: "!NODE_EXE!"
)

where npm >nul 2>&1
if errorlevel 1 (
    echo ERROR: npm not found in PATH. Reinstall Node.js from https://nodejs.org/ or ensure npm is installed.
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
    exit /b 1
)

echo.
echo --- Ensuring TypeScript is installed...
call "!NPM_CMD!" install typescript@5.4.5 --save-dev
if errorlevel 1 (
    echo ERROR: Failed to install TypeScript.
    exit /b 1
)

echo.
echo --- Building TypeScript...
if exist dist (
    echo --- Cleaning dist directory...
    rmdir /s /q dist
    if errorlevel 1 (
        echo ERROR: Failed to clean dist directory.
        exit /b 1
    )
)

if exist "node_modules\typescript\bin\tsc.js" (
    echo --- Found tsc.js, running build...
    "!NODE_EXE!" "node_modules\typescript\bin\tsc.js"
    if errorlevel 1 (
        echo ERROR: Build failed. Check tsconfig.json or TypeScript output above for details.
        exit /b 1
    )
) else (
    echo --- Falling back to npx tsc...
    call "!NPM_CMD!" exec -- tsc -p tsconfig.json
    if errorlevel 1 (
        echo ERROR: Build failed with npx. Check tsconfig.json or TypeScript output above for details.
        exit /b 1
    )
)

echo.
echo --- Generating MCP configuration...
set "PROJECT_ROOT=%CD%"
if exist mcp.json (
    echo --- mcp.json already exists, skipping generation.
) else (
    echo --- Generating MCP configuration...
    echo { > mcp.json
    echo   "mcpServers": { >> mcp.json
    echo     "FileScopeMCP": { >> mcp.json
    echo       "command": "node", >> mcp.json
    echo       "args": ["%PROJECT_ROOT:\=\\%\\dist\\mcp-server.js", "--base-dir=%PROJECT_ROOT:\=\\%"], >> mcp.json
    echo       "transport": "stdio" >> mcp.json
    echo     } >> mcp.json
    echo   } >> mcp.json
    echo } >> mcp.json
)

echo.
echo === Setup Complete ===
echo --- MCP configuration generated at ./mcp.json
echo --- Project root: %PROJECT_ROOT%
echo.
echo To integrate with Cursor AI:
echo 1. Create a ".cursor" folder in your project root (%PROJECT_ROOT%) if it doesn't exist.
echo 2. Copy mcp.json to the .cursor folder to enable MCP server integration.
echo.
echo Or run the server manually: "!NODE_EXE!" dist/mcp-server.js

ENDLOCAL