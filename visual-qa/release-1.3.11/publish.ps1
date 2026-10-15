$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$repository = 'Validolio11/Karkas-app-'
$version = '1.3.11'
$root = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
Push-Location $root
try {
  # Release evidence may be untracked; every source/index change must be committed.
  $dirty = @(git status --porcelain --untracked-files=all)
  if ($LASTEXITCODE -ne 0) { throw 'Cannot read Git status' }
  foreach ($line in $dirty) {
    if ($line -notmatch '^\?\? visual-qa/release-1\.3\.11/') { throw "Commit source/index changes before publication: $line" }
  }
  $commit = (git rev-parse HEAD).Trim()
  $headPackage = (git show HEAD:package.json | Out-String | ConvertFrom-Json)
  $workingPackage = Get-Content -Raw -LiteralPath package.json | ConvertFrom-Json
  if ($headPackage.version -ne $version -or $workingPackage.version -ne $version) { throw 'HEAD and working package must match the release version' }
  $remoteUrl = (git remote get-url origin).Trim()
  if ($remoteUrl -notmatch 'github\.com[:/]Validolio11/Karkas-app-(\.git)?$') { throw 'Unexpected origin repository' }
  git fetch origin main --quiet
  if ($LASTEXITCODE -ne 0) { throw 'Cannot refresh remote main' }
  git merge-base --is-ancestor $commit origin/main
  if ($LASTEXITCODE -ne 0) { throw 'Remote main must contain release HEAD' }
  $remoteTag = @(git ls-remote --tags origin "refs/tags/$version" "refs/tags/v$version")
  if ($LASTEXITCODE -ne 0) { throw 'Cannot inspect release tags' }
  if ($remoteTag.Count) { throw 'Release tag already exists; inspect existing release before retrying' }

  $outputPath = Join-Path $root "release/release-$version"
  $assetNames = @("Karkas-Setup-$version.exe", "Karkas-Setup-$version.exe.blockmap", 'latest.yml')
  $localAssets = @{}
  foreach ($name in $assetNames) {
    $assetPath = Join-Path $outputPath $name
    if (-not (Test-Path -LiteralPath $assetPath -PathType Leaf)) { throw "Missing asset: $name" }
    $localAssets[$name] = @{ path = $assetPath; size = (Get-Item -LiteralPath $assetPath).Length; sha256 = (Get-FileHash -LiteralPath $assetPath -Algorithm SHA256).Hash.ToLowerInvariant() }
  }
  $manifest = Get-Content -Raw -LiteralPath (Join-Path $outputPath 'latest.yml')
  $escapedVersion = [regex]::Escape($version)
  if ($manifest -notmatch "(?m)^version: ['\`"]?$escapedVersion['\`"]?\s*$") { throw 'latest.yml version mismatch' }
  $installerName = "Karkas-Setup-$version.exe"
  if (-not $manifest.Contains($installerName)) { throw 'latest.yml installer mismatch' }
  $installerSha512 = (Get-FileHash -LiteralPath $localAssets[$installerName].path -Algorithm SHA512).Hash
  $shaBytes = for ($i = 0; $i -lt $installerSha512.Length; $i += 2) { [Convert]::ToByte($installerSha512.Substring($i, 2), 16) }
  if (-not $manifest.Contains([Convert]::ToBase64String([byte[]]$shaBytes))) { throw 'latest.yml installer SHA512 mismatch' }
  $notesPath = Join-Path $PSScriptRoot 'notes.md'
  $releaseBody = [IO.File]::ReadAllText($notesPath, [Text.Encoding]::UTF8).Trim()
  if (-not $releaseBody) { throw 'Release notes are empty' }
  $credentialLines = @('protocol=https', 'host=github.com', '') | git -c credential.interactive=never credential fill 2>$null
  if ($LASTEXITCODE -ne 0) { throw 'GitHub credential lookup failed' }
  $tokenLine = $credentialLines | Where-Object { $_.StartsWith('password=') } | Select-Object -First 1
  if (-not $tokenLine) { throw 'GitHub credential unavailable' }
  $headers = @{ Authorization = 'Bearer ' + $tokenLine.Substring(9); Accept = 'application/vnd.github+json'; 'X-GitHub-Api-Version' = '2022-11-28'; 'User-Agent' = 'Karkas-Release' }
  $api = "https://api.github.com/repos/$repository/releases"
  $create = @{ tag_name = $version; target_commitish = $commit; name = "Karkas $version"; body = $releaseBody; draft = $true; prerelease = $false } | ConvertTo-Json
  $release = Invoke-RestMethod -Method Post -Uri $api -Headers $headers -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes($create))
  Write-Output "Created draft release $version"
  $uploadBase = $release.upload_url -replace '\{.*$', ''
  $verifiedAssets = @()
  foreach ($name in $assetNames) {
    $local = $localAssets[$name]
    $asset = Invoke-RestMethod -Method Post -Uri "${uploadBase}?name=$([Uri]::EscapeDataString($name))" -Headers $headers -ContentType 'application/octet-stream' -InFile $local.path -TimeoutSec 300
    if ($asset.size -ne $local.size -or $asset.state -ne 'uploaded') { throw "Asset upload verification failed: $name" }
    $expectedDigest = 'sha256:' + $local.sha256
    if ($asset.PSObject.Properties.Name -contains 'digest' -and $asset.digest) {
      if ($asset.digest -ne $expectedDigest) { throw "Asset digest mismatch: $name" }
    } else {
      $temporaryAsset = [IO.Path]::GetTempFileName()
      try {
        $downloadHeaders = $headers.Clone()
        $downloadHeaders.Accept = 'application/octet-stream'
        Invoke-WebRequest -UseBasicParsing -Uri $asset.url -Headers $downloadHeaders -OutFile $temporaryAsset -TimeoutSec 300
        if ((Get-FileHash -LiteralPath $temporaryAsset -Algorithm SHA256).Hash.ToLowerInvariant() -ne $local.sha256) { throw "Downloaded asset digest mismatch: $name" }
      } finally { Remove-Item -LiteralPath $temporaryAsset -Force }
    }
    $verifiedAssets += @{ name = $name; size = $asset.size; sha256 = $local.sha256; url = $asset.browser_download_url }
    Write-Output "Verified $name ($($asset.size) bytes)"
  }
  $published = Invoke-RestMethod -Method Patch -Uri "$api/$($release.id)" -Headers $headers -ContentType 'application/json' -Body (@{ draft = $false; make_latest = 'true' } | ConvertTo-Json)
  if ($published.draft -or -not $published.published_at) { throw 'Publication was not confirmed' }
  $publicAssets = @($published.assets | ForEach-Object {
    $local = $localAssets[$_.name]
    if (-not $local -or $_.size -ne $local.size) { throw 'Published asset mismatch' }
    @{ name = $_.name; size = $_.size; sha256 = $local.sha256; url = $_.browser_download_url }
  })
  @{ version = $version; commit = $commit; releaseId = $published.id; url = $published.html_url; publishedAt = $published.published_at; assets = $publicAssets } | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $PSScriptRoot 'publication.json') -Encoding UTF8
  Write-Output "Published $($published.html_url)"
} finally { Pop-Location }
