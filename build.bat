@echo off
SETLOCAL EnableDelayedExpansion

echo === Starting MCP File Rank Setup ===

:: Check for Node.js in Program Files
set "NODE_EXE=C:\Program Files\nodejs\node.exe"
set "NPM_CMD=C:\Program Files\nodejs\npm.cmd"

if exist "%NODE_EXE%" (
    echo --- Using Node.js from: "%NODE_EXE%"
) else (
    set "NODE_EXE=C:\Program Files (x86)\nodejs\node.exe"
    set "NPM_CMD=C:\Program Files (x86)\nodejs\npm.cmd"
    if exist "%NODE_EXE%" (
        echo --- Using Node.js from: "%NODE_EXE%"
    ) else (
        echo ERROR: Node.js not found. Please install from https://nodejs.org/
        exit /b 1
    )
)

:: Add Node.js directory to PATH
for %%F in ("%NODE_EXE%") do set "NODE_DIR=%%~dpF"
set "PATH=%NODE_DIR%;%PATH%"

echo.
echo --- Installing dependencies...
call "%NPM_CMD%" install
if errorlevel 1 (
    echo ERROR: Failed to install dependencies.
    exit /b 1
)

echo.
echo --- Ensuring TypeScript is installed...
call "%NPM_CMD%" install typescript@^5.4.5 --save-dev
if errorlevel 1 (
    echo ERROR: Failed to install TypeScript.
    exit /b 1
)

echo.
echo --- Building TypeScript...
echo --- Checking for tsc.js...
if exist "node_modules\typescript\bin\tsc.js" (
    echo --- Found tsc.js, running build...
    "%NODE_EXE%" "node_modules\typescript\bin\tsc.js"
    if errorlevel 1 (
        echo ERROR: Build failed. Check tsconfig.json or TypeScript errors above.
        exit /b 1
    )
) else (
    echo --- tsc.js not found, listing bin contents...
    dir "node_modules\typescript\bin" 2>nul || echo Bin directory missing.
    echo --- Falling back to npx tsc...
    call "%NPM_CMD%" exec -- tsc
    if errorlevel 1 (
        echo ERROR: Build failed with npx. Check tsconfig.json or TypeScript errors above.
        exit /b 1
    )
)

echo.
echo --- Generating MCP configuration...
set "PROJECT_ROOT=%CD%"
set "NODE_EXE_ESCAPED=%NODE_EXE:\=\\%"

echo { > mcp.json
echo   "mcpServers": { >> mcp.json
echo     "file-rank-mcp": { >> mcp.json
echo       "command": "%NODE_EXE_ESCAPED%", >> mcp.json
echo       "args": ["%PROJECT_ROOT:\=\\%\\dist\\mcp-server.js"], >> mcp.json
echo       "transport": "stdio" >> mcp.json
echo     } >> mcp.json
echo   } >> mcp.json
echo } >> mcp.json

echo.
echo === Setup Complete ===
echo --- MCP configuration generated at ./mcp.json
echo --- Project root: %PROJECT_ROOT%
echo.
echo To use with Cursor AI:
echo 1. Create a ".cursor" folder in your project if it doesn't exist
echo 2. Copy mcp.json to the .cursor folder
echo.
echo Or run the server manually: "%NODE_EXE%" dist/mcp-server.js

ENDLOCAL