$expectedVersion = '1.24.0'
$exePath = Resolve-Path 'release/win-unpacked/Karkas.exe'
$actualVersion = (Get-Item $exePath).VersionInfo.FileVersion
Write-Host "FileVersion: $actualVersion"
if ($actualVersion -ne $expectedVersion) {
    throw "Packaged executable version $actualVersion does not match package.json version $expectedVersion"
}

$installer = Get-Item "release/Karkas-Setup-$expectedVersion.exe"
$updateMetadata = Get-Content 'release/latest.yml' -Raw
if (-not $updateMetadata.Contains($installer.Name)) {
    throw "latest.yml does not reference the published installer $($installer.Name)"
}
Write-Host "latest.yml references installer: PASS"

$env:ELECTRON_RUN_AS_NODE = '1'
$env:KARKAS_TEST_APP_DIR = (Resolve-Path 'release/win-unpacked/resources/app.asar').Path
$smokeTest = (Resolve-Path 'electron/server-runtime.test.cjs').Path

$stdout = [System.IO.Path]::GetTempFileName()
$stderr = [System.IO.Path]::GetTempFileName()
$process = Start-Process -FilePath $exePath.Path -ArgumentList "--test `"$smokeTest`"" -WindowStyle Hidden -Wait -PassThru -RedirectStandardOutput $stdout -RedirectStandardError $stderr
$outContent = Get-Content $stdout
$errContent = Get-Content $stderr
Remove-Item $stdout, $stderr

if ($outContent) { Write-Host $outContent }
if ($errContent) { Write-Host $errContent }

if ($process.ExitCode -ne 0) {
    throw "Smoke test failed with exit code $($process.ExitCode)"
}
Write-Host "Packaged runtime smoke test: PASS"
