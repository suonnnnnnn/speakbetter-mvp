param(
  [ValidateSet('start','stop','status')]
  [string]$Action = 'start'
)

$ErrorActionPreference = 'SilentlyContinue'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$pidFile = Join-Path $root 'server.pid'
$outLog = Join-Path $root 'server.out.log'
$errLog = Join-Path $root 'server.err.log'
$node = 'C:\Program Files\nodejs\node.exe'

function Get-AlivePid {
  if (!(Test-Path $pidFile)) { return $null }
  $pidText = (Get-Content -LiteralPath $pidFile -Raw).Trim()
  if ($pidText -notmatch '^[0-9]+$') { return $null }
  $p = Get-Process -Id ([int]$pidText) -ErrorAction SilentlyContinue
  if ($null -eq $p) { return $null }
  return [int]$pidText
}

if ($Action -eq 'stop') {
  $pid = Get-AlivePid
  if ($pid) {
    Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
    Write-Output "stopped pid=$pid"
  } else {
    Write-Output 'not_running'
  }
  exit 0
}

if ($Action -eq 'status') {
  $pid = Get-AlivePid
  if ($pid) {
    $listen = netstat -ano | findstr LISTENING | findstr ':5173' | findstr " $pid"
    if ($listen) {
      Write-Output "running pid=$pid listen=5173"
    } else {
      Write-Output "running pid=$pid no_listen"
    }
  } else {
    Write-Output 'not_running'
  }
  exit 0
}

# start
$exist = Get-AlivePid
if ($exist) {
  Write-Output "already_running pid=$exist"
  exit 0
}

if (Test-Path $outLog) { Remove-Item -LiteralPath $outLog -Force }
if (Test-Path $errLog) { Remove-Item -LiteralPath $errLog -Force }

$env:PORT = '5173'
$env:HOST = '127.0.0.1'
$p = Start-Process -FilePath $node -ArgumentList 'server.js' -WorkingDirectory $root -RedirectStandardOutput $outLog -RedirectStandardError $errLog -PassThru
$p.Id | Set-Content -LiteralPath $pidFile -Encoding ASCII
Start-Sleep -Seconds 2

$listen = netstat -ano | findstr LISTENING | findstr ':5173' | findstr " $($p.Id)"
if ($listen) {
  Write-Output "started pid=$($p.Id)"
} else {
  Write-Output "start_failed pid=$($p.Id)"
  Write-Output '---ERR---'
  Get-Content -LiteralPath $errLog -ErrorAction SilentlyContinue
  Write-Output '---OUT---'
  Get-Content -LiteralPath $outLog -ErrorAction SilentlyContinue
}
