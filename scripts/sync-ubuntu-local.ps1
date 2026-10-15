param(
  [string]$Source = ""
)
$ErrorActionPreference = "Stop"
$script = Join-Path $PSScriptRoot "sync-ubuntu-local.js"
& node $script
exit $LASTEXITCODE
