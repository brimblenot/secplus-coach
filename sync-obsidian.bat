@echo off
REM ============================================================
REM  Sec+ -> Obsidian auto-sync
REM  Pulls live progress from Supabase and updates your vault.
REM  Edit VAULT below to point at your Obsidian vault folder.
REM ============================================================

set "OBSIDIAN_VAULT=C:\Users\samka\Desktop\Cybersecurity\security-knowledge-base"

cd /d "%~dp0"
call npm run kb:sync

REM  Keep the window open only when run by hand (not when scheduled).
if "%1"=="" pause
