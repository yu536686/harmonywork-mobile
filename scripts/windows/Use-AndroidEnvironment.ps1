# Dot-source for Android SDK inspection/init commands; use Build-AndroidDebug.cmd for APK builds (it also loads MSVC).
# Paths stay process-local so the existing desktop build environment is unaffected.
$env:JAVA_HOME = 'C:\Android\jdk-21'
$env:ANDROID_HOME = 'C:\Android\Sdk'
$env:ANDROID_SDK_ROOT = $env:ANDROID_HOME
$env:GRADLE_USER_HOME = 'C:\Android\gradle-cache'
$env:CARGO_HOME = 'C:\Android\cargo-home-harmonywork'
$env:RUSTUP_HOME = 'E:\xiaoheng-tools\rustup'
$env:CARGO_TARGET_DIR = 'C:\Android\cargo-target\harmony-work-mobile'

$ndkRoot = Join-Path $env:ANDROID_HOME 'ndk'
$ndk = if (Test-Path $ndkRoot) {
    Get-ChildItem $ndkRoot -Directory | Where-Object { Test-Path (Join-Path $_.FullName 'source.properties') } | Sort-Object Name -Descending | Select-Object -First 1
}
if ($ndk) {
    $env:NDK_HOME = $ndk.FullName
}

$env:PATH = "$env:JAVA_HOME\bin;$env:ANDROID_HOME\platform-tools;E:\xiaoheng-tools\cargo\bin;$env:PATH"

if (-not (Test-Path (Join-Path $env:JAVA_HOME 'bin\java.exe'))) {
    throw "JDK is missing from $env:JAVA_HOME"
}
if (-not (Test-Path (Join-Path $env:ANDROID_HOME 'cmdline-tools\latest\bin\sdkmanager.bat'))) {
    throw "Android command-line tools are missing from $env:ANDROID_HOME"
}
