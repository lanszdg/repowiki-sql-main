@echo off
REM CodeGraph offline launcher - uses the node.exe bundled next to this script.
"%~dp0node.exe" "%~dp0dist\bin\codegraph.js" %*
