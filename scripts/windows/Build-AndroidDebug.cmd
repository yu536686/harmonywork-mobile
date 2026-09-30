@echo off
setlocal
set "VCVARS=C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat"
if not exist "%VCVARS%" goto missing_vcvars
call "%VCVARS%" >nul
if errorlevel 1 exit /b 1

set "JAVA_HOME=C:\Android\jdk-21"
set "ANDROID_HOME=C:\Android\Sdk"
set "ANDROID_SDK_ROOT=%ANDROID_HOME%"
set "NDK_HOME=%ANDROID_HOME%\ndk\28.2.13676358"
set "GRADLE_USER_HOME=C:\Android\gradle-cache"
set "CARGO_HOME=C:\Android\cargo-home-harmonywork"
set "RUSTUP_HOME=E:\xiaoheng-tools\rustup"
set "CARGO_TARGET_DIR=C:\Android\cargo-target\harmony-work-mobile"
set "CARGO_BUILD_JOBS=1"
set "CARGO_PROFILE_DEV_DEBUG=0"
set "GRADLE_OPTS=-Dorg.gradle.daemon=false -Dorg.gradle.workers.max=1 -Dorg.gradle.jvmargs=-Xmx768m"
set "PATH=%JAVA_HOME%\bin;%ANDROID_HOME%\platform-tools;E:\xiaoheng-tools\cargo\bin;%PATH%"
rem Java/Gradle does not automatically use the HTTPS_PROXY environment variable.
if defined HTTPS_PROXY for /f "tokens=2,3 delims=:/" %%H in ("%HTTPS_PROXY%") do set "JAVA_TOOL_OPTIONS=%JAVA_TOOL_OPTIONS% -Dhttps.proxyHost=%%H -Dhttps.proxyPort=%%I -Dhttp.proxyHost=%%H -Dhttp.proxyPort=%%I"

if not exist "%JAVA_HOME%\bin\java.exe" exit /b 1
if not exist "%NDK_HOME%\source.properties" exit /b 1
for %%I in ("%~dp0..\..") do set "PROJECT_ROOT=%%~fI"
cd /d "%PROJECT_ROOT%\apps\mobile" || exit /b 1
npm run tauri android build -- --debug --apk --target aarch64 --ci
exit /b %errorlevel%

:missing_vcvars
echo Missing Visual Studio C++ Build Tools: %VCVARS% 1>&2
exit /b 1
