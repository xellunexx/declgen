# Native Windows pickers for the declgen web surface (server runs on the user's machine).
# Usage: powershell -STA -NoProfile -ExecutionPolicy Bypass -File native-dialog.ps1 -Mode files|folder|profile
param([string]$Mode = 'files')
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

# Foreground forcer: a 1x1 nearly-invisible topmost owner makes the dialog appear on top.
$owner = New-Object System.Windows.Forms.Form
$owner.TopMost = $true
$owner.StartPosition = 'CenterScreen'
$owner.Width = 1
$owner.Height = 1
$owner.Opacity = 0.01
$owner.ShowInTaskbar = $false
$owner.Show()

if ($Mode -eq 'folder') {
  $d = New-Object System.Windows.Forms.FolderBrowserDialog
  $d.Description = 'Изберете папка с документи (PDF/CSV/XML/XLSX)'
  $d.ShowNewFolderButton = $false
  $result = $d.ShowDialog($owner)
  if ($result -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $d.SelectedPath }
} else {
  $d = New-Object System.Windows.Forms.OpenFileDialog
  if ($Mode -eq 'profile') {
    $d.Title = 'Изберете XML профил'
    $d.Filter = 'XML файлове (*.xml)|*.xml'
    $d.Multiselect = $false
  } else {
    $d.Title = 'Изберете документи'
    $d.Filter = 'Документи (*.pdf;*.csv;*.xml;*.xlsx)|*.pdf;*.csv;*.xml;*.xlsx|Всички файлове (*.*)|*.*'
    $d.Multiselect = $true
  }
  $d.RestoreDirectory = $true
  $result = $d.ShowDialog($owner)
  if ($result -eq [System.Windows.Forms.DialogResult]::OK) {
    foreach ($f in $d.FileNames) { Write-Output $f }
  }
}
$owner.Close()
