# Installs what the release built on Windows and checks that it works: the
# NSIS installer, the MSI and the portable zip. release.yml runs it after the
# build; without -Bundles it only tries the portable, to run it locally.
param(
  [string]$Bundles,
  [Parameter(Mandatory)][string]$Version,
  [Parameter(Mandatory)][string]$Portable
)
$ErrorActionPreference = 'Stop'

# The app and the MCP server are in the folder, and the server is this version.
function Assert-Installed([string]$dir) {
  $mcp = Join-Path $dir 'ultimatemd-mcp.exe'
  if (-not (Test-Path $mcp)) { throw "No MCP server in $dir" }
  $said = & $mcp --version
  if ($said -ne "ultimatemd-mcp $Version") { throw "The MCP server in $dir says '$said', not $Version" }
  $app = @('UltimateMD.exe', 'ultimatemd.exe') | ForEach-Object { Join-Path $dir $_ } | Where-Object { Test-Path $_ } | Select-Object -First 1
  if (-not $app) { throw "No app in $dir" }
  Write-Host "ok: $app and $mcp $Version"
  return $app
}

if ($Bundles) {
  $setup = Get-ChildItem "$Bundles/nsis/*-setup.exe" | Select-Object -First 1
  if (-not $setup) { throw "No NSIS installer in $Bundles/nsis" }
  $nsis = 'C:\umd-nsis'
  # /D must come last and without quotes.
  Start-Process $setup.FullName -ArgumentList '/S', "/D=$nsis" -Wait
  $null = Assert-Installed $nsis
  Start-Process "$nsis\uninstall.exe" -ArgumentList '/S' -Wait
  # The uninstaller hands over to a copy of itself and returns at once.
  Start-Sleep -Seconds 10

  $msi = Get-ChildItem "$Bundles/msi/*.msi" | Select-Object -First 1
  if (-not $msi) { throw "No MSI in $Bundles/msi" }
  $log = Join-Path $env:RUNNER_TEMP 'msi.log'
  # Asked for a folder of its own, as with NSIS.
  $msiDir = 'C:\umd-msi'
  $run = Start-Process msiexec -ArgumentList '/i', "`"$($msi.FullName)`"", '/qn', '/norestart', "INSTALLDIR=`"$msiDir`"", '/l*v', "`"$log`"" -Wait -PassThru
  if ($run.ExitCode -ne 0) {
    Get-Content $log -Tail 40
    throw "The MSI failed with $($run.ExitCode)"
  }
  # The MSI reuses the folder of an earlier install, here the NSIS one, over
  # the one asked for; its log says where it went.
  $line = Select-String -Path $log -Pattern '^Property\(S\): INSTALLDIR = (.+)$' | Select-Object -Last 1
  $installed = if ($line) { $line.Matches[0].Groups[1].Value.Trim().TrimEnd('\') } else { $msiDir }
  Write-Host "The MSI installed in $installed"
  $null = Assert-Installed $installed
}

# The portable must start and keep its log in datos, beside it.
$unzipped = Join-Path ($env:RUNNER_TEMP ?? $env:TEMP) 'umd-portable'
Remove-Item $unzipped -Recurse -Force -ErrorAction SilentlyContinue
Expand-Archive $Portable $unzipped
$folder = Join-Path $unzipped 'UltimateMD'
if (-not (Test-Path "$folder\portable")) { throw 'The zip has no portable mark' }
$app = Assert-Installed $folder
$started = Start-Process $app -WorkingDirectory $folder -PassThru
Start-Sleep -Seconds 15
try {
  $logFile = "$folder\datos\ultimatemd.log"
  if (-not (Test-Path $logFile)) { throw 'The portable app did not write datos\ultimatemd.log' }
  $text = Get-Content $logFile -Raw
  if ($text -match 'panic') { throw "The portable app failed:`n$text" }
  if ($text -notmatch "UltimateMD $([regex]::Escape($Version))") { throw "Unexpected log:`n$text" }
  if ($started.HasExited) { throw "The portable app closed by itself with $($started.ExitCode)" }
  Write-Host "ok: the portable app runs and keeps its data in $folder\datos"
} finally {
  $null = $started.CloseMainWindow()
  if (-not $started.WaitForExit(10000)) { Stop-Process -Id $started.Id -Force -ErrorAction SilentlyContinue }
}
