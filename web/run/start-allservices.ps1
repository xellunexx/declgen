$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$origin = 'http://127.0.0.1:48913'
$watchdog = Join-Path $PSScriptRoot 'watchdog.ps1'
$urlFile = Join-Path $PSScriptRoot 'current_url.txt'
$lastShownFile = Join-Path $PSScriptRoot 'last-announced-url.txt'
$psExe = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"

function Say([string]$message) { Write-Host "[Declgen] $message" }
function Watchdog-Running {
    @(Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" | Where-Object {
        $_.CommandLine -and $_.CommandLine.Contains($watchdog)
    }).Count -gt 0
}
function Local-Healthy {
    try { return (Invoke-RestMethod "$origin/__health" -TimeoutSec 5).ok -eq $true } catch { return $false }
}
function Public-Healthy([string]$url) {
    try { return (Invoke-RestMethod "$url/__health" -TimeoutSec 10).ok -eq $true } catch { return $false }
}
function Show-LinkBox([string]$url) {
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing
    $form = New-Object Windows.Forms.Form
    $form.Text = 'Declgen WAN link'
    $form.StartPosition = 'CenterScreen'
    $form.ClientSize = New-Object Drawing.Size(720, 145)
    $form.TopMost = $true
    $label = New-Object Windows.Forms.Label
    $label.Text = 'New public link — select it or use Copy:'
    $label.AutoSize = $true
    $label.Location = New-Object Drawing.Point(18, 18)
    $box = New-Object Windows.Forms.TextBox
    $box.Text = $url
    $box.ReadOnly = $true
    $box.Font = New-Object Drawing.Font('Consolas', 10)
    $box.Location = New-Object Drawing.Point(18, 46)
    $box.Size = New-Object Drawing.Size(684, 26)
    $copy = New-Object Windows.Forms.Button
    $copy.Text = 'Copy link'
    $copy.Location = New-Object Drawing.Point(510, 92)
    $copy.Size = New-Object Drawing.Size(92, 30)
    $copy.Add_Click({ [Windows.Forms.Clipboard]::SetText($box.Text); $copy.Text = 'Copied' })
    $close = New-Object Windows.Forms.Button
    $close.Text = 'Close'
    $close.Location = New-Object Drawing.Point(610, 92)
    $close.Size = New-Object Drawing.Size(92, 30)
    $close.Add_Click({ $form.Close() })
    $form.Controls.AddRange(@($label, $box, $copy, $close))
    $form.Add_Shown({ $box.SelectAll(); $box.Focus() })
    [void]$form.ShowDialog()
}

Set-Location -LiteralPath $root
Say 'Starting local service, WAN tunnel, and watchdog...'
if (-not (Watchdog-Running)) {
    Start-Process -FilePath $psExe -ArgumentList "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$watchdog`"" -WindowStyle Hidden
    Start-Sleep -Milliseconds 500
}

$deadline = (Get-Date).AddSeconds(75)
$url = $null
while ((Get-Date) -lt $deadline) {
    if ((Local-Healthy) -and (Test-Path $urlFile)) {
        $candidate = (Get-Content -LiteralPath $urlFile -Raw).Trim()
        if ($candidate -match '^https://[a-z0-9-]+\.trycloudflare\.com$' -and (Public-Healthy $candidate)) {
            $url = $candidate
            break
        }
    }
    Start-Sleep -Seconds 2
}

if (-not $url) {
    Say 'FAILED: Local and public service did not both become healthy within 75 seconds.'
    Say "Local health: $(if (Local-Healthy) { 'OK' } else { 'FAILED' })"
    exit 1
}

Say 'Local health: OK'
Say 'WAN health: OK'
Write-Host ''
Write-Host '+--------------------------------------------------------------------+'
Write-Host (('|  {0,-66}  |' -f $url))
Write-Host '+--------------------------------------------------------------------+'

$lastShown = if (Test-Path $lastShownFile) { (Get-Content -LiteralPath $lastShownFile -Raw).Trim() } else { '' }
if ($url -ne $lastShown) {
    [IO.File]::WriteAllText($lastShownFile, $url, (New-Object Text.UTF8Encoding($false)))
    Show-LinkBox $url
} else {
    Say 'The WAN link is unchanged; no copy dialog was needed.'
}
