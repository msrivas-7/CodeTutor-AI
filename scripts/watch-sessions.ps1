# watch-sessions.ps1 — live feed of per-session runner container lifecycle.
# Parallel to scripts/watch-sessions.sh.
#
# Note: stdout/stderr from user code runs does NOT appear here. It streams
# through `docker exec` back to the backend — look in the backend window.
# This window is for seeing WHEN containers are spawned/destroyed per session.

$ErrorActionPreference = "Continue"

$PREFIX = "ai-code-editor-session-"

function Colour-Event($status) {
    switch ($status) {
        "start"   { return @{ Fg = "Green";   Text = $status.PadRight(8) } }
        "create"  { return @{ Fg = "Cyan";    Text = $status.PadRight(8) } }
        "die"     { return @{ Fg = "Yellow";  Text = $status.PadRight(8) } }
        "destroy" { return @{ Fg = "Red";     Text = $status.PadRight(8) } }
        "kill"    { return @{ Fg = "Magenta"; Text = $status.PadRight(8) } }
        default   { return @{ Fg = "Gray";    Text = $status.PadRight(8) } }
    }
}

function Print-Header {
    Write-Host "═══ SESSION RUNNERS ═══" -ForegroundColor Cyan
    Write-Host "Shows per-session container lifecycle (create/start/die/destroy/kill)." -ForegroundColor DarkGray
    Write-Host "User-code output from Run streams through the backend window, not here." -ForegroundColor DarkGray
    Write-Host ""
}

function Print-Current-Snapshot {
    Write-Host "current session containers:" -ForegroundColor Cyan
    $listing = docker ps --filter "name=^$PREFIX" --format "  {{.Names}}  {{.Status}}" 2>$null
    if (-not $listing) {
        Write-Host "  (none — start a session in the UI)" -ForegroundColor DarkGray
    } else {
        Write-Host $listing
    }
    Write-Host ""
}

Print-Header
Print-Current-Snapshot
Write-Host "─── live events (Ctrl-C to exit) ───" -ForegroundColor Cyan

# Infinite retry — if `docker events` exits (daemon restart, Docker Desktop
# pause, pipe error), note it and reconnect so the window stays useful.
while ($true) {
    Write-Host "[listening for events…]" -ForegroundColor DarkGray

    # docker events produces one line per event. Stream with PowerShell's
    # pipeline and filter to our container prefix.
    try {
        docker events `
            --filter "type=container" `
            --filter "event=create" `
            --filter "event=start" `
            --filter "event=die" `
            --filter "event=destroy" `
            --filter "event=kill" `
            --format "{{.Time}}|{{.Action}}|{{.Actor.Attributes.name}}" 2>$null |
        ForEach-Object {
            $parts = $_ -split "\|", 3
            if ($parts.Length -lt 3) { return }
            $ts, $status, $name = $parts
            if (-not $name.StartsWith($PREFIX)) { return }
            try {
                $human = [DateTimeOffset]::FromUnixTimeSeconds([int64]$ts).LocalDateTime.ToString("HH:mm:ss")
            } catch { $human = $ts }
            $short = $name.Substring($PREFIX.Length)
            $ev = Colour-Event $status
            Write-Host ("[{0}] " -f $human) -NoNewline
            Write-Host $ev.Text -NoNewline -ForegroundColor $ev.Fg
            Write-Host ("  {0}" -f $PREFIX) -NoNewline -ForegroundColor DarkGray
            Write-Host $short
        }
    } catch { }

    Write-Host "[event stream dropped — reconnecting in 2s]" -ForegroundColor Yellow
    Start-Sleep -Seconds 2
}
