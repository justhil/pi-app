# 下载 codex-asr 发布包到 resources/codex-asr/（打包前执行）
# 用法: .\scripts\fetch-codex-asr.ps1 -Version "0.1.0"
param(
  [string]$Version = "latest",
  [string]$Repo = "Wangnov/codex-asr"
)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$dest = Join-Path $root "resources\codex-asr"
New-Item -ItemType Directory -Force -Path $dest | Out-Null
Write-Host "Fetch $Repo release ($Version) -> $dest"
Write-Host "Manual: download codex-asr-*-x86_64-pc-windows-msvc.zip from GitHub Releases"
Write-Host "  extract codex-asr.exe to resources\codex-asr\win-x64\codex-asr.exe"
Write-Host "macOS: resources/codex-asr/darwin-universal/codex-asr"
Write-Host "linux: resources/codex-asr/linux-x64/codex-asr"