$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$repository = 'Validolio11/Karkas-app-'
$version = '1.3.4'
$outputPath = Join-Path $PSScriptRoot '../../release/release-1.3.4'
$assetNames = @("Karkas-Setup-$version.exe", "Karkas-Setup-$version.exe.blockmap", 'latest.yml')
foreach ($name in $assetNames) {
  if (-not (Test-Path -LiteralPath (Join-Path $outputPath $name) -PathType Leaf)) { throw "Missing release asset: $name" }
}
$credentialLines = @('protocol=https', 'host=github.com', '') | git -c credential.interactive=never credential fill 2>$null
if ($LASTEXITCODE -ne 0) { throw 'GitHub credential lookup failed' }
$tokenLine = $credentialLines | Where-Object { $_.StartsWith('password=') } | Select-Object -First 1
if (-not $tokenLine) { throw 'GitHub credential unavailable' }
$githubToken = $tokenLine.Substring('password='.Length)
$headers = @{ Authorization = "Bearer $githubToken"; Accept = 'application/vnd.github+json'; 'X-GitHub-Api-Version' = '2022-11-28'; 'User-Agent' = 'Karkas-Release' }
$commit = (git rev-parse HEAD).Trim()
$releaseBody = @'
Покрокове створення завдань та виправлення надійності Karkas:

- Компактна покрокова форма: назва/опис, категорія, пріоритет, календар, облік часу та підкроки.
- Окремий день роботи й дедлайн, відображення дат на картці, редагування вручну та через ШІ.
- Збереження дат у синхронізації; правильний часовий пояс повторюваних завдань.
- Відновлення збереженого простору без запуску старих запитів і без перезаписування пошкоджених даних.
- Прибрано дубльовані таймери, невикористаний код та універсальні квоти продуктивності.
- Виправлено контекст ШІ й безпеку production-залежностей.

Перевірки: 516/516 тестів, TypeScript та перевірка невикористаного коду, строгий профіль утиліт, production і Windows NSIS, запакований runtime/native storage, ізольовані desktop/mobile сценарії чату, стратегії, введення та відновлення.
'@
$api = "https://api.github.com/repos/$repository/releases"
$create = @{ tag_name = $version; target_commitish = $commit; name = "Karkas $version"; body = $releaseBody; draft = $true; prerelease = $false } | ConvertTo-Json
$release = Invoke-RestMethod -Method Post -Uri $api -Headers $headers -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes($create))
Write-Output "Created draft release $version"
$uploadBase = $release.upload_url -replace '\{.*$', ''
$uploadedAssets = @()
foreach ($name in $assetNames) {
  $assetPath = Join-Path $outputPath $name
  $uploadUri = "${uploadBase}?name=$([Uri]::EscapeDataString($name))"
  $asset = Invoke-RestMethod -Method Post -Uri $uploadUri -Headers $headers -ContentType 'application/octet-stream' -InFile $assetPath -TimeoutSec 300
  if ($asset.size -ne (Get-Item -LiteralPath $assetPath).Length -or $asset.state -ne 'uploaded') { throw "Asset upload verification failed: $name" }
  if ($asset.PSObject.Properties.Name -contains 'digest' -and $asset.digest) {
    $expectedDigest = 'sha256:' + (Get-FileHash -LiteralPath $assetPath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($asset.digest -ne $expectedDigest) { throw "Asset digest mismatch: $name" }
  }
  $uploadedAssets += @{ name = $asset.name; size = $asset.size; url = $asset.browser_download_url }
  Write-Output "Uploaded $name ($($asset.size) bytes)"
}
$publish = @{ draft = $false; make_latest = 'true' } | ConvertTo-Json
$published = Invoke-RestMethod -Method Patch -Uri "$api/$($release.id)" -Headers $headers -ContentType 'application/json' -Body $publish
if ($published.draft -or -not $published.published_at) { throw 'Publication was not confirmed' }
@{ version = $version; commit = $commit; releaseId = $published.id; url = $published.html_url; publishedAt = $published.published_at; assets = @($published.assets | ForEach-Object { @{ name = $_.name; size = $_.size; url = $_.browser_download_url } }) } | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $PSScriptRoot 'publication.json') -Encoding UTF8
Write-Output "Published $($published.html_url)"
# Publication response is authoritative; do not poll or monitor GitHub afterward.
