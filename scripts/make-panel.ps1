# Builds the native panel window (dist/LoL-Scoreboard-Panel.exe).
# Downloads the WebView2 SDK from nuget once (cached in assets/webview2),
# then compiles scripts/Panel.cs with the .NET Framework csc built into Windows.
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$wv2 = Join-Path $root 'assets\webview2'

if (-not (Test-Path (Join-Path $wv2 'Microsoft.Web.WebView2.WinForms.dll'))) {
  Write-Host 'Downloading WebView2 SDK from nuget...'
  New-Item -ItemType Directory -Force $wv2 | Out-Null
  $zip = Join-Path $env:TEMP 'webview2.nupkg.zip'
  Invoke-WebRequest 'https://www.nuget.org/api/v2/package/Microsoft.Web.WebView2/1.0.2210.55' -OutFile $zip
  $extract = Join-Path $env:TEMP 'webview2-extract'
  if (Test-Path $extract) { Remove-Item $extract -Recurse -Force }
  Expand-Archive $zip $extract
  Copy-Item (Join-Path $extract 'lib\net45\Microsoft.Web.WebView2.Core.dll') $wv2
  Copy-Item (Join-Path $extract 'lib\net45\Microsoft.Web.WebView2.WinForms.dll') $wv2
  Copy-Item (Join-Path $extract 'runtimes\win-x64\native\WebView2Loader.dll') $wv2
  Remove-Item $zip, $extract -Recurse -Force
}

$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $csc)) { throw "csc.exe not found at $csc" }

New-Item -ItemType Directory -Force (Join-Path $root 'dist') | Out-Null
$cscArgs = @(
  '/nologo', '/target:winexe',
  "/out:$(Join-Path $root 'dist\LoL-Scoreboard-Panel.exe')",
  "/win32icon:$(Join-Path $root 'assets\icon.ico')",
  '/r:System.Windows.Forms.dll', '/r:System.Drawing.dll',
  "/r:$(Join-Path $wv2 'Microsoft.Web.WebView2.Core.dll')",
  "/r:$(Join-Path $wv2 'Microsoft.Web.WebView2.WinForms.dll')",
  (Join-Path $root 'scripts\Panel.cs')
)
& $csc @cscArgs
if ($LASTEXITCODE -ne 0) { throw "csc failed" }

# runtime deps must sit next to the panel exe
Copy-Item (Join-Path $wv2 '*.dll') (Join-Path $root 'dist') -Force
Write-Host 'panel built -> dist/LoL-Scoreboard-Panel.exe'

# HUD reader (cover-mode exact gold + objective counts)
$hudArgs = @(
  '/nologo', '/target:exe',
  "/out:$(Join-Path $root 'dist\HudReader.exe')",
  (Join-Path $root 'scripts\HudReader.cs')
)
& $csc @hudArgs
if ($LASTEXITCODE -ne 0) { throw "csc HudReader failed" }
Copy-Item (Join-Path $root 'assets\fonts\*.ttf') (Join-Path $root 'dist') -Force
Write-Host 'hud reader built -> dist/HudReader.exe'
