# 构建安卓 APK（Windows / 已安装 Android Studio 或命令行 SDK 的机器）
# 用法：powershell -ExecutionPolicy Bypass -File scripts/build-apk.ps1 [-Debug]
# 说明：网页层已预构建在 app/src/main/assets/web；如需修改网页源码，先运行 scripts/build-web.ps1

param(
    [switch]$Release
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

# 1. JDK
if (-not $env:JAVA_HOME) {
    $candidates = @(
        'D:\develop\Java\jdk-21.0.11',
        "$env:ProgramFiles\Android\Android Studio\jbr",
        "$env:ProgramFiles\Eclipse Adoptium\jdk-21*",
        "$env:ProgramFiles\Java\jdk-21*"
    )
    foreach ($candidate in $candidates) {
        $resolved = Get-Item $candidate -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($resolved) { $env:JAVA_HOME = $resolved.FullName; break }
    }
}
if (-not $env:JAVA_HOME -or -not (Test-Path "$env:JAVA_HOME\bin\java.exe")) {
    throw '未找到 JDK 21+，请安装 JDK 21 并设置 JAVA_HOME。'
}
Write-Host "JDK: $env:JAVA_HOME"

# 2. Android SDK
if (-not $env:ANDROID_HOME) {
    $local = Get-Content "$root\local.properties" -ErrorAction SilentlyContinue |
        Where-Object { $_ -match '^sdk\.dir=' } |
        ForEach-Object { $_ -replace '^sdk\.dir=', '' }
    if ($local -and (Test-Path $local)) { $env:ANDROID_HOME = $local }
}
if (-not $env:ANDROID_HOME -and $env:ANDROID_SDK_ROOT) { $env:ANDROID_HOME = $env:ANDROID_SDK_ROOT }
$sdkCandidates = @(
    $env:ANDROID_HOME,
    "$env:LOCALAPPDATA\Android\Sdk"
)
foreach ($candidate in $sdkCandidates) {
    if ($candidate -and (Test-Path "$candidate\platforms\android-36\android.jar")) { $env:ANDROID_HOME = $candidate; break }
}
if (-not $env:ANDROID_HOME -or -not (Test-Path "$env:ANDROID_HOME\platforms\android-36\android.jar")) {
    throw '未找到 Android SDK（需要 platform android-36 与 build-tools 36.0.0），请用 Android Studio 安装后设置 ANDROID_HOME。'
}
$env:ANDROID_SDK_ROOT = $env:ANDROID_HOME
Write-Host "Android SDK: $env:ANDROID_HOME"
"# 由 build-apk.ps1 自动生成`nsdk.dir=$($env:ANDROID_HOME -replace '\\','/')" | Set-Content "$root\local.properties" -Encoding ascii

# 3. 构建
$task = if ($Release) { ':app:assembleRelease' } else { ':app:assembleDebug' }
Write-Host "运行 gradlew $task ..."
$gradlew = if ($IsWindows -or $env:OS -eq 'Windows_NT') { '.\gradlew.bat' } else { './gradlew' }
& $gradlew $task --console=plain
if ($LASTEXITCODE -ne 0) { throw "构建失败（exit $LASTEXITCODE）" }

# 4. 收集产物
$variant = if ($Release) { 'release' } else { 'debug' }
$apk = Get-ChildItem "$root\app\build\outputs\apk\$variant" -Filter '*.apk' | Select-Object -First 1
if (-not $apk) { throw '构建完成但未找到 APK 产物。' }
New-Item -ItemType Directory -Force "$root\dist" | Out-Null
Copy-Item $apk.FullName "$root\dist\$($apk.Name)" -Force
Write-Host "APK: $root\dist\$($apk.Name)"
