# 构建网页层（把 webapp/src 打包进 app/src/main/assets/web）
# 用法：powershell -ExecutionPolicy Bypass -File scripts/build-web.ps1
# 依赖：Node.js 20+、pnpm

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location "$root\webapp"

if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
    throw '未找到 pnpm，请先安装：npm i -g pnpm'
}

Write-Host '安装网页层依赖 ...'
pnpm install

Write-Host '打包静态站到 app/src/main/assets/web ...'
pnpm build:web
if ($LASTEXITCODE -ne 0) { throw "网页打包失败（exit $LASTEXITCODE）" }

Write-Host '完成。重新运行 scripts/build-apk.ps1 生成 APK。'
