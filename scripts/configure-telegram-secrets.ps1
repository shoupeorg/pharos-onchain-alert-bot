$ErrorActionPreference = "Stop"
$Project = Split-Path -Parent $PSScriptRoot
Set-Location $Project
$env:XDG_CONFIG_HOME = (Resolve-Path "..\cloudflare-xdg").Path

function Read-Hidden([string]$Prompt) {
  $secure = Read-Host $Prompt -AsSecureString
  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}
function Put-Secret([string]$Name, [string]$Value) {
  if ([string]::IsNullOrWhiteSpace($Value)) { throw "$Name must not be empty." }
  $Value | & node "..\pharos-event-monitor\node_modules\wrangler\bin\wrangler.js" secret put $Name
  if ($LASTEXITCODE -ne 0) { throw "Failed to store $Name (exit $LASTEXITCODE)." }
}
$botToken = Read-Hidden "Telegram bot token (hidden)"
$chatId = Read-Hidden "Telegram numeric chat ID (hidden)"
$ownerToken = Read-Hidden "Choose/enter the owner token used by the UI (hidden)"
try {
  Put-Secret "TELEGRAM_BOT_TOKEN" $botToken
  Put-Secret "TELEGRAM_CHAT_ID" $chatId
  Put-Secret "OWNER_TOKEN" $ownerToken
  Write-Host "TELEGRAM AND OWNER SECRETS CONFIGURED" -ForegroundColor Green
} finally {
  $botToken = $null
  $chatId = $null
  $ownerToken = $null
  [GC]::Collect()
}
