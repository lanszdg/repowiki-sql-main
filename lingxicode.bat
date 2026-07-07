@echo off
REM ========================================
REM  LingxiCode Offline Launcher
REM ========================================

set OPENCODE_PARSERS_DIR=%~dp0parsers
set OPENCODE_DISABLE_AUTOUPDATE=true
set OPENCODE_DISABLE_MODELS_FETCH=true
set OPENCODE_DISABLE_LSP_DOWNLOAD=true
set OPENCODE_CONFIG_DIR=%~dp0config

REM --- CodeGraph (fact layer / single authoritative graph) ---
REM Put the bundled codegraph launcher on PATH so mcp.codegraph in opencode.json resolves "codegraph".
set CODEGRAPH_HOME=%~dp0config\bin\codegraph
set PATH=%CODEGRAPH_HOME%;%PATH%

REM set ENTERPRISE_API_KEY=sk-your-key-here

"%~dp0bin/opencode.exe" %*