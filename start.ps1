# start.ps1 — one-command launcher for AI Code Editor on Windows.
# Parallel to start.sh. Expected invocation:
#     powershell -ExecutionPolicy Bypass -File .\start.ps1
#
# Requires Docker Desktop running and the drive containing this repo enabled
# in Docker Desktop → Settings → Resources → File Sharing.

$ErrorActionPreference = "Continue"
Set-Location -Path $PSScriptRoot

function Write-Step($msg)   { Write-Host "> $msg" -ForegroundColor Cyan }
function Write-Ok($msg)     { Write-Host "  [OK] $msg" -ForegroundColor Green }
function Write-Warn($msg)   { Write-Host "  [!!] $msg" -ForegroundColor Red }

# --- Docker daemon check -----------------------------------------------

Write-Host "Checking Docker daemon..."
$null = docker info 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Warn "Docker daemon not reachable. Is Docker Desktop running?"
    Write-Warn "Install from https://www.docker.com/products/docker-desktop/ or start it and re-run."
    exit 1
}
Write-Ok "Docker daemon reachable"

# --- Drive-sharing preflight ------------------------------------------
# Docker Desktop on Windows silently produces an empty bind mount if the
# drive containing the repo isn't shared. Catch that up front instead of
# debugging a confused backend later.

Write-Step "Verifying bind-mount from this folder..."
$testDir = Join-Path $PSScriptRoot "temp\sessions"
if (-not (Test-Path $testDir)) { New-Item -ItemType Directory -Force -Path $testDir | Out-Null }
$marker = Join-Path $testDir ".mount-probe"
"probe" | Out-File -FilePath $marker -Encoding ASCII -NoNewline
$mountArg = "${testDir}:/probe"
$null = docker run --rm -v $mountArg alpine sh -c "test -f /probe/.mount-probe" 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Warn "Bind mount failed. Open Docker Desktop → Settings → Resources → File Sharing"
    Write-Warn "and enable the drive containing this folder, then re-run."
    Remove-Item -ErrorAction SilentlyContinue $marker
    exit 1
}
Write-Ok "bind mount works"
Remove-Item -ErrorAction SilentlyContinue $marker

# --- Bring the stack up -----------------------------------------------

Write-Step "Building + starting AI Code Editor (this is fast after the first run)..."
docker compose up --build -d
if ($LASTEXITCODE -ne 0) {
    Write-Warn "docker compose up failed."
    exit 1
}

# --- Wait for health --------------------------------------------------

function Wait-For-Url($url, $label, $maxSec) {
    Write-Step "Waiting for $label..."
    for ($i = 0; $i -lt $maxSec; $i++) {
        try {
            $resp = Invoke-WebRequest -Uri $url -TimeoutSec 2 -UseBasicParsing -ErrorAction Stop
            if ($resp.StatusCode -ge 200 -and $resp.StatusCode -lt 500) {
                Write-Ok "$label ready"
                return $true
            }
        } catch { }
        Start-Sleep -Seconds 1
    }
    Write-Warn "$label didn't respond in ${maxSec}s -- check: docker compose logs"
    return $false
}

Wait-For-Url "http://localhost:4000/api/health" "backend on :4000" 45 | Out-Null
Wait-For-Url "http://localhost:5173" "frontend on :5173" 30 | Out-Null

# --- Log windows ------------------------------------------------------
# Spawn three PowerShell windows tailing backend, frontend, and session
# events. Capture PIDs to a file so stop.ps1 can close exactly the windows
# we opened. (Windows Terminal `wt.exe` is prettier but doesn't give us a
# clean per-tab PID to close later — separate windows are simpler.)

$pidFile = Join-Path $PSScriptRoot ".ai-code-editor-terminals"
Remove-Item -ErrorAction SilentlyContinue $pidFile

function Start-LogWindow($title, $command) {
    $script = "`$Host.UI.RawUI.WindowTitle = '$title'; Write-Host '=== $title ===' -ForegroundColor Cyan; $command"
    $proc = Start-Process -FilePath "powershell.exe" `
        -ArgumentList "-NoExit", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", $script `
        -WorkingDirectory $PSScriptRoot -PassThru
    return $proc.Id
}

try {
    Write-Step "Opening log windows..."
    $p1 = Start-LogWindow "BACKEND LOGS"  "docker compose logs -f backend"
    $p2 = Start-LogWindow "FRONTEND LOGS" "docker compose logs -f frontend"
    $p3 = Start-LogWindow "SESSION RUNNERS" "& '$PSScriptRoot\scripts\watch-sessions.ps1'"
    "$p1,$p2,$p3" | Out-File -FilePath $pidFile -Encoding ASCII -NoNewline
    Write-Ok "3 PowerShell windows opened: backend / frontend / session runners"
} catch {
    Write-Warn "Couldn't open log windows. Tail manually:"
    Write-Host "    docker compose logs -f backend" -ForegroundColor DarkGray
    Write-Host "    docker compose logs -f frontend" -ForegroundColor DarkGray
    Write-Host "    .\scripts\watch-sessions.ps1" -ForegroundColor DarkGray
}

# --- Summary + open browser ------------------------------------------

Write-Host ""
Write-Host "----------------------------------------------" -ForegroundColor Green
Write-Host "  AI Code Editor is running"
Write-Host "  UI       http://localhost:5173" -ForegroundColor Cyan
Write-Host "  Backend  http://localhost:4000" -ForegroundColor Cyan
Write-Host "----------------------------------------------" -ForegroundColor Green
Write-Host ""
Write-Host "  Logs stream in the 3 PowerShell windows that just opened." -ForegroundColor DarkGray
Write-Host "  Stop the stack:   .\stop.ps1" -ForegroundColor DarkGray
Write-Host "  Closing log windows does NOT stop the stack -- use .\stop.ps1" -ForegroundColor DarkGray
Write-Host ""

Start-Process "http://localhost:5173"
