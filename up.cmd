@echo off
cd /d "%~dp0" && docker compose up -d --build && echo Config Studio is ready: http://localhost:3000
