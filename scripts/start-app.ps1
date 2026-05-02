# start-app.ps1 — uruchamia aplikację Next.js, zabijając poprzedni proces jeśli port 3000 jest zajęty
param(
    [int]$Port = 3000,
    [int]$WaitSeconds = 30
)

$AppDir = $PSScriptRoot | Split-Path -Parent
$PidFile = Join-Path $AppDir ".nextpid"

# 1. Zabij poprzedni zapisany proces
if (Test-Path $PidFile) {
    $savedPid = Get-Content $PidFile -ErrorAction SilentlyContinue
    if ($savedPid) {
        $proc = Get-Process -Id ([int]$savedPid) -ErrorAction SilentlyContinue
        if ($proc) {
            Write-Host "Zatrzymuję poprzedni proces (PID $savedPid)..."
            Stop-Process -Id ([int]$savedPid) -Force -ErrorAction SilentlyContinue
            Start-Sleep -Milliseconds 1000
        }
    }
    Remove-Item $PidFile -Force -ErrorAction SilentlyContinue
}

# 2. Sprawdź czy port 3000 jest nadal zajęty — zabij po PID
$tcpConns = netstat -ano 2>$null | Select-String ":$Port\s" | Select-Object -First 5
foreach ($line in $tcpConns) {
    if ($line -match 'LISTENING\s+(\d+)') {
        $pid = [int]$Matches[1]
        if ($pid -gt 0) {
            Write-Host "Port $Port zajęty przez PID $pid — zatrzymuję..."
            Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue
            Start-Sleep -Milliseconds 1500
        }
    }
}

# 3. Uruchom npm run dev w nowym oknie (widocznym ale minimalizowanym)
Write-Host "Uruchamiam aplikację w $AppDir..."
$job = Start-Process powershell.exe -ArgumentList @(
    '-NoProfile',
    '-Command',
    "Set-Location '$AppDir'; npm run dev"
) -PassThru -WindowStyle Minimized

# Zapisz PID procesu powershell (node będzie child-em)
if ($job) {
    $job.Id | Out-File $PidFile -Force
    Write-Host "Proces uruchomiony (PID $($job.Id)), czekam na port $Port..."
}

# 4. Czekaj aż port odpowie
$elapsed = 0
$ready = $false
while ($elapsed -lt $WaitSeconds) {
    Start-Sleep -Seconds 2
    $elapsed += 2
    try {
        $tcp = New-Object System.Net.Sockets.TcpClient
        $tcp.Connect("127.0.0.1", $Port)
        $tcp.Close()
        $ready = $true
        break
    } catch {
        Write-Host "Czekam... ($elapsed/${WaitSeconds}s)"
    }
}

if ($ready) {
    Write-Host "Aplikacja gotowa! Otwieram przeglądarkę..."
    Start-Process "http://localhost:$Port"
} else {
    Write-Host "Timeout — aplikacja mogła się nie uruchomić w czasie ${WaitSeconds}s."
    Write-Host "Spróbuj otworzyć ręcznie: http://localhost:$Port"
    Start-Process "http://localhost:$Port"
}
