@echo off
setlocal
set "VCVARS=C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat"
if not exist "%VCVARS%" exit /b 1
call "%VCVARS%" >nul
if errorlevel 1 exit /b 1
set "CARGO_HOME=C:\Android\cargo-home-harmonywork"
set "RUSTUP_HOME=E:\xiaoheng-tools\rustup"
set "CARGO_TARGET_DIR=C:\Android\cargo-target\harmony-work-mobile"
set "CARGO_BUILD_JOBS=1"
set "CARGO_PROFILE_DEV_DEBUG=0"
set "PATH=E:\xiaoheng-tools\cargo\bin;%PATH%"
for %%I in ("%~dp0..\..") do set "PROJECT_ROOT=%%~fI"
cd /d "%PROJECT_ROOT%\apps\mobile\src-tauri" || exit /b 1
cargo test --lib %*
exit /b %errorlevel%
