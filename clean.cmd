@echo off
cd /d "%~dp0" && docker compose down -v --rmi local --remove-orphans && del /q data\config.json data\last_run.json 2>nul
