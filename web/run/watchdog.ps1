$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
Set-Location -LiteralPath $root
$mutex = New-Object Threading.Mutex($false, 'Local\DeclgenComplete48913Watchdog')
try { $locked = $mutex.WaitOne(0) } catch [Threading.AbandonedMutexException] { $locked = $true }
if (-not $locked) { exit }
$nvmRoot = 'C:\Users\ochak\AppData\Local\Author Software\nvm\installs'
$node = @(
    Get-ChildItem -LiteralPath $nvmRoot -Directory -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -match '^v22\.' } |
        Sort-Object { [version]$_.Name.Substring(1) } -Descending |
        ForEach-Object { Join-Path $_.FullName 'node.exe' } |
        Where-Object { Test-Path -LiteralPath $_ } |
        Select-Object -First 1
)[0]
if (-not $node) {
    throw 'A compatible Node.js 22.x runtime was not found for Declgen.'
}
$cloud = 'C:\Program Files (x86)\cloudflared\cloudflared.exe'
$origin = 'http://127.0.0.1:48913'
$env:DECLGEN_WEB_HOST = '127.0.0.1'
$env:DECLGEN_WEB_PORT = '48913'
$env:DECLGEN_AUTH = 'on'
$env:DECLGEN_DATA_ROOT = Join-Path $root 'declgen-data'
function Log($message) { Add-Content -LiteralPath "$PSScriptRoot/watchdog-windows.log" -Value "$(Get-Date -Format o) $message" }
function Healthy {
    try { return (Invoke-RestMethod "$origin/__health" -TimeoutSec 10).ok -eq $true } catch { return $false }
}
function Find-Server {
    Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -and $_.CommandLine.Contains((Join-Path $root 'web\server.mjs')) } | Select-Object -First 1
}
function Find-Tunnel {
    Get-CimInstance Win32_Process -Filter "Name='cloudflared.exe'" | Where-Object { $_.CommandLine -and $_.CommandLine.Contains("--url $origin") } | Select-Object -First 1
}
function Start-Server {
    $existing = Find-Server
    if ($existing) { Stop-Process -Id $existing.ProcessId -Force }
    $p = Start-Process -FilePath $node -ArgumentList ('"' + (Join-Path $root 'web\server.mjs') + '"') -WorkingDirectory $root -WindowStyle Hidden -RedirectStandardOutput "$PSScriptRoot/server-windows.log" -RedirectStandardError "$PSScriptRoot/server-windows-error.log" -PassThru
    Log "Server started PID $($p.Id)"
}
function Start-Tunnel {
    $p = Start-Process -FilePath $cloud -ArgumentList "tunnel --config web/cloudflared-quick.yml --url $origin --no-autoupdate" -WorkingDirectory $root -WindowStyle Hidden -RedirectStandardOutput "$PSScriptRoot/tunnel-windows-out.log" -RedirectStandardError "$PSScriptRoot/tunnel-windows.log" -PassThru
    Log "Tunnel started PID $($p.Id)"
}
function Save-Url {
    if (-not (Test-Path "$PSScriptRoot/tunnel-windows.log")) { return }
    $logText = Get-Content "$PSScriptRoot/tunnel-windows.log" -Raw
    if ([string]::IsNullOrEmpty($logText)) { return }
    $matches = [regex]::Matches($logText, 'https://[a-z0-9-]+\.trycloudflare\.com')
    if ($matches.Count -eq 0) { return }
    $url = $matches[$matches.Count - 1].Value
    if ($script:lastUrl -eq $url) { return }
    $utf8 = New-Object Text.UTF8Encoding($false)
    [IO.File]::WriteAllText("$PSScriptRoot/current_url.txt", $url, $utf8)
    $wan = @{url=$url;target=$origin;ts=(Get-Date).ToUniversalTime().ToString('o')} | ConvertTo-Json
    [IO.File]::WriteAllText("$root/declgen-data/wan.json", $wan, $utf8)
    $script:lastUrl = $url
    Log "Public URL: $url"
}
try {
    [IO.File]::WriteAllText("$PSScriptRoot/watchdog-windows.pid", [string]$PID)
    Log "Watchdog started PID $PID"
    $fails = 0
    while ($true) {
        try {
            if (Healthy) { $fails = 0 }
            else {
                $fails++
                if ((-not (Find-Server)) -or $fails -ge 4) { Start-Server; $fails = 0 }
            }
            if (-not (Find-Tunnel)) { Start-Tunnel }
            Save-Url
        } catch { Log "Check failed: $_" }
        Start-Sleep -Seconds 30
    }
} finally { $mutex.ReleaseMutex(); $mutex.Dispose() }
