@echo off
cd /d "%~dp0"
docker run --rm -v "%cd%\frontend:/app" -w /app node:20-alpine npm install --package-lock-only --no-audit --no-fund || exit /b 1
docker run --rm -v "%cd%\backend:/src" -w /src golang:1.22-alpine go mod tidy || exit /b 1
echo Lockfiles written: frontend\package-lock.json and backend\go.sum
