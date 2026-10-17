# Sets up Fox Todo as an always-on server on Windows:
#   - starts it when the PC boots (no login needed) and restarts it if it crashes
#   - opens the port in Windows Firewall for your home network (Private profile only)
#
# Run from the project folder in PowerShell *as Administrator*:
#   powershell -ExecutionPolicy Bypass -File scripts\install-windows.ps1
# To remove everything it set up:
#   powershell -ExecutionPolicy Bypass -File scripts\install-windows.ps1 -Uninstall

param(
  [switch]$Uninstall
)
$ErrorActionPreference = 'Stop'

$AppTask = 'Fox Todo'
$FirewallRule = 'Fox Todo'

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
  [Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) { throw 'Run this from PowerShell opened with "Run as administrator".' }

if ($Uninstall) {
  if (Get-ScheduledTask -TaskName $AppTask -ErrorAction SilentlyContinue) {
    Stop-ScheduledTask -TaskName $AppTask -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $AppTask -Confirm:$false
    Write-Host "Removed task '$AppTask'"
  }
  Remove-NetFirewallRule -DisplayName $FirewallRule -ErrorAction SilentlyContinue
  Write-Host 'Removed firewall rule. Your data folder was left untouched.'
  return
}

$AppDir = Split-Path -Parent $PSScriptRoot
$Node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $Node) { throw 'Node.js was not found. Install the LTS version from https://nodejs.org and open a new PowerShell window.' }

# Read PORT from .env (default 3000) for the firewall rule.
$Port = 3000
$EnvFile = Join-Path $AppDir '.env'
if (Test-Path $EnvFile) {
  $line = Get-Content $EnvFile | Where-Object { $_ -match '^\s*PORT\s*=\s*(\d+)' } | Select-Object -First 1
  if ($line -match '(\d+)') { $Port = [int]$Matches[1] }
}

New-Item -ItemType Directory -Force -Path (Join-Path $AppDir 'data') | Out-Null

# Runs as SYSTEM so it works with nobody logged in. Output goes to data\server.log.
$runApp = "/c cd /d `"$AppDir`" && `"$Node`" --env-file-if-exists=.env server.js >> data\server.log 2>&1"
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest

$appSettings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName $AppTask -Force -Principal $principal -Settings $appSettings `
  -Action (New-ScheduledTaskAction -Execute 'cmd.exe' -Argument $runApp -WorkingDirectory $AppDir) `
  -Trigger (New-ScheduledTaskTrigger -AtStartup) | Out-Null

Remove-NetFirewallRule -DisplayName $FirewallRule -ErrorAction SilentlyContinue
New-NetFirewallRule -DisplayName $FirewallRule -Direction Inbound -Protocol TCP -LocalPort $Port -Action Allow -Profile Private | Out-Null

# (Re)start the app now.
Stop-ScheduledTask -TaskName $AppTask -ErrorAction SilentlyContinue
Start-ScheduledTask -TaskName $AppTask
Start-Sleep -Seconds 3

$ip = (Get-NetIPAddress -AddressFamily IPv4 -PrefixOrigin Dhcp, Manual -ErrorAction SilentlyContinue |
  Where-Object { $_.IPAddress -notlike '169.*' } | Select-Object -First 1).IPAddress
try {
  Invoke-WebRequest -UseBasicParsing -Uri "http://localhost:$Port/" -TimeoutSec 5 | Out-Null
  Write-Host "Fox Todo is running." -ForegroundColor Green
} catch {
  Write-Warning "The app didn't answer yet. Check $AppDir\data\server.log"
}
Write-Host "  On this PC:        http://localhost:$Port"
if ($ip) { Write-Host "  On your network:   http://${ip}:$Port" }
Write-Host "Make sure your Wi-Fi/Ethernet network is set to Private in Windows settings, or other devices can't connect."
