# stop.ps1 — tear down the stack and close the log windows that start.ps1
# opened. Parallel to stop.sh.

$ErrorActionPreference = "Continue"
Set-Location -Path $PSScriptRoot

Write-Host "> Stopping AI Code Editor..." -ForegroundColor Cyan
docker compose down --remove-orphans

# Close the three log windows recorded by start.ps1 (if any).
$pidFile = Join-Path $PSScriptRoot ".ai-code-editor-terminals"
if (Test-Path $pidFile) {
    $ids = (Get-Content $pidFile -Raw).Trim()
    Remove-Item -ErrorAction SilentlyContinue $pidFile
    if ($ids) {
        Write-Host "> Closing log windows..." -ForegroundColor Cyan
        foreach ($id in $ids -split ",") {
            $pidTrimmed = $id.Trim()
            if ($pidTrimmed) {
                Stop-Process -Id $pidTrimmed -Force -ErrorAction SilentlyContinue
            }
        }
    }
}

Write-Host "[OK] Stopped." -ForegroundColor Green
