param(
    [string]$JsonPath = "$PSScriptRoot\leaderboard.json",
    [string]$TokenPath = "$PSScriptRoot\github_token.txt"
)

$ErrorActionPreference = "Stop"

$Owner = "its-hei"
$Repo = "YURA-Network"
$Branch = "live-data"
$RemotePath = "leaderboard.json"

if (-not (Test-Path -LiteralPath $JsonPath)) {
    throw "Brak pliku leaderboard.json: $JsonPath"
}

if (-not (Test-Path -LiteralPath $TokenPath)) {
    throw "Brak github_token.txt: $TokenPath"
}

$Token = (Get-Content -LiteralPath $TokenPath -Raw).Trim()
if ([string]::IsNullOrWhiteSpace($Token)) {
    throw "github_token.txt jest pusty."
}

$Headers = @{
    "Accept" = "application/vnd.github+json"
    "Authorization" = "Bearer $Token"
    "X-GitHub-Api-Version" = "2022-11-28"
    "User-Agent" = "YURA-Leaderboard-Sync"
}

$EncodedPath = [uri]::EscapeDataString($RemotePath)
$ApiUrl = "https://api.github.com/repos/$Owner/$Repo/contents/$EncodedPath"

$LocalBytes = [System.IO.File]::ReadAllBytes($JsonPath)
$LocalText = [System.Text.Encoding]::UTF8.GetString($LocalBytes)

# Validate JSON before upload.
$null = $LocalText | ConvertFrom-Json

$Sha = $null
try {
    $Current = Invoke-RestMethod `
        -Uri "$ApiUrl?ref=$Branch" `
        -Headers $Headers `
        -Method Get

    $Sha = $Current.sha
}
catch {
    if ($_.Exception.Response.StatusCode.value__ -ne 404) {
        throw
    }
}

$Base64 = [Convert]::ToBase64String($LocalBytes)

$Body = @{
    message = "data: sync Y.U.R.A. leaderboard"
    content = $Base64
    branch = $Branch
}

if ($Sha) {
    $Body.sha = $Sha
}

$JsonBody = $Body | ConvertTo-Json -Depth 5

$result = Invoke-RestMethod `
    -Uri $ApiUrl `
    -Headers $Headers `
    -Method Put `
    -ContentType "application/json; charset=utf-8" `
    -Body $JsonBody

Write-Host "Y.U.R.A. leaderboard synced." -ForegroundColor Green
Write-Host ("Commit: " + $result.commit.sha)
