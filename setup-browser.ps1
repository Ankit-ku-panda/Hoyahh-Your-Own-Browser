$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot
$electronVersion = '44.3.0'
$browserRuntime = Join-Path $projectRoot 'browser-runtime'
$architecture = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64' -or $env:PROCESSOR_ARCHITEW6432 -eq 'ARM64') { 'arm64' } else { 'x64' }
$assetName = "electron-v$electronVersion-win32-$architecture.zip"
$versionFile = Join-Path $browserRuntime 'veil-runtime-version.txt'
$expectedVersion = "$electronVersion-$architecture"
if (-not (Test-Path $versionFile) -or (Get-Content $versionFile -Raw).Trim() -ne $expectedVersion) {
    if (Test-Path (Join-Path $browserRuntime 'electron.exe')) {
        $running = Get-Process electron -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq (Join-Path $browserRuntime 'electron.exe') }
        if ($running) { throw 'Close Hoyahh before updating it.' }
    }
    Write-Host 'Downloading Chromium/Electron from the official Electron release. This first download can take several minutes.'
    $releaseURL = "https://github.com/electron/electron/releases/download/v$electronVersion"
    $downloadDirectory = Join-Path ([IO.Path]::GetTempPath()) ('veil-browser-' + [Guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory $downloadDirectory | Out-Null
    try {
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        $archive = Join-Path $downloadDirectory $assetName
        $checksums = Join-Path $downloadDirectory 'SHASUMS256.txt'
        Invoke-WebRequest -UseBasicParsing "$releaseURL/SHASUMS256.txt" -OutFile $checksums
        Invoke-WebRequest -UseBasicParsing "$releaseURL/$assetName" -OutFile $archive
        $line = Get-Content $checksums | Where-Object { $_ -match ('\s+\*?' + [regex]::Escape($assetName) + '$') } | Select-Object -First 1
        if (-not $line) { throw 'The official checksum list does not contain this download.' }
        $expectedHash = ($line.Trim() -split '\s+')[0]
        $actualHash = (Get-FileHash -Algorithm SHA256 $archive).Hash
        if ($actualHash -ne $expectedHash) { throw 'Download checksum mismatch. The browser was not installed.' }
        $expanded = Join-Path $downloadDirectory 'runtime'
        Expand-Archive -LiteralPath $archive -DestinationPath $expanded
        if (-not (Test-Path (Join-Path $expanded 'electron.exe'))) { throw 'The runtime download is incomplete.' }
        if (Test-Path $browserRuntime) { Remove-Item -LiteralPath $browserRuntime -Recurse -Force }
        Move-Item -LiteralPath $expanded -Destination $browserRuntime
        Set-Content -LiteralPath $versionFile -Value $expectedVersion -Encoding ASCII
    } finally { Remove-Item -LiteralPath $downloadDirectory -Recurse -Force -ErrorAction SilentlyContinue }
}
$running = Get-Process electron -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq (Join-Path $browserRuntime 'electron.exe') }
if ($running) { throw 'Hoyahh is already open. Close it before running this launcher again.' }
$appDirectory = Join-Path $browserRuntime 'resources\app'
New-Item -ItemType Directory -Force $appDirectory | Out-Null
Copy-Item -Path (Join-Path $projectRoot 'browser\*.cjs') -Destination $appDirectory -Force
Copy-Item -LiteralPath (Join-Path $projectRoot 'browser\package.json') -Destination $appDirectory -Force
Copy-Item -Path (Join-Path $projectRoot 'browser\ui') -Destination $appDirectory -Recurse -Force
Start-Process -FilePath (Join-Path $browserRuntime 'electron.exe') -WorkingDirectory $browserRuntime
