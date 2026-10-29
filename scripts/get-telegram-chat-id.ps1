$ErrorActionPreference = "Stop"
function Read-Hidden([string]$Prompt) {
  $secure = Read-Host $Prompt -AsSecureString
  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}
$token = Read-Hidden "Telegram bot token (hidden)"
try {
  $response = Invoke-RestMethod -Method Get -Uri ("https://api.telegram.org/bot{0}/getUpdates" -f $token) -TimeoutSec 20
  if (-not $response.ok) { throw "Telegram getUpdates returned ok=false." }
  $ids = @($response.result | ForEach-Object {
    $message = if ($_.message) { $_.message } elseif ($_.channel_post) { $_.channel_post } else { $null }
    if ($message -and $message.chat) { [pscustomobject]@{ ChatId = [string]$message.chat.id; Type = [string]$message.chat.type } }
  } | Sort-Object ChatId -Unique)
  if ($ids.Count -eq 0) { throw "No chat update found. Open the bot chat, press Start, send a harmless message, then run this script again." }
  $ids | Format-Table -AutoSize
  Write-Host "Use the private chat ID shown above. Do not share the token or full getUpdates response." -ForegroundColor Green
} finally {
  $token = $null
  [GC]::Collect()
}
