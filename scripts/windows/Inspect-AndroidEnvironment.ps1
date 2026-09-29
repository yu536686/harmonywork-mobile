[CmdletBinding()]
param(
    [string]$OutputPath = ''
)

# Read-only inventory, apart from writing the JSON report. No installs or reboot.
if (-not $OutputPath) {
    $scriptDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
    $OutputPath = Join-Path $scriptDirectory '..\..\reports\android-environment.json'
}
$ErrorActionPreference = 'Continue'
$report = [ordered]@{
    capturedAt = (Get-Date).ToUniversalTime().ToString('o')
    computer = $env:COMPUTERNAME
    powershell = $PSVersionTable.PSVersion.ToString()
    note = 'Inventory only; successful collection does not verify APK builds.'
}

function Read-Probe {
    param([scriptblock]$Action)
    try {
        $value = & $Action
        return @{ status = 'observed'; data = $value }
    } catch {
        return @{ status = 'unknown'; error = $_.Exception.Message }
    }
}

function Get-ToolVersion {
    param([string]$Executable, [string[]]$ToolArguments = @('--version'))
    $command = Get-Command $Executable -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $command) { return @{ status = 'not-found'; executable = $Executable } }
    try {
        $output = & $command.Source @ToolArguments 2>&1 | Out-String
        $code = $LASTEXITCODE
        return @{ status = $(if ($code -eq 0) { 'ok' } else { 'error' }); path = $command.Source; exitCode = $code; output = $output.Trim() }
    } catch {
        return @{ status = 'error'; path = $command.Source; error = $_.Exception.Message }
    }
}

$report.os = Read-Probe { Get-CimInstance Win32_OperatingSystem -ErrorAction Stop | Select-Object Caption, Version, OSArchitecture, TotalVisibleMemorySize, FreePhysicalMemory }
$report.cpu = Read-Probe { Get-CimInstance Win32_Processor -ErrorAction Stop | Select-Object Name, NumberOfCores, NumberOfLogicalProcessors, VirtualizationFirmwareEnabled, SecondLevelAddressTranslationExtensions }
$report.computerSystem = Read-Probe { Get-CimInstance Win32_ComputerSystem -ErrorAction Stop | Select-Object Manufacturer, Model, TotalPhysicalMemory, HypervisorPresent }
$report.gpu = Read-Probe { Get-CimInstance Win32_VideoController -ErrorAction Stop | Select-Object Name, DriverVersion }
$report.drives = Read-Probe { Get-CimInstance Win32_LogicalDisk -Filter 'DriveType = 3' -ErrorAction Stop | Select-Object DeviceID, FileSystem, Size, FreeSpace }
$report.whpx = Read-Probe { Get-WindowsOptionalFeature -Online -FeatureName HypervisorPlatform -ErrorAction Stop | Select-Object FeatureName, @{Name='State'; Expression={$_.State.ToString()}} }

$report.tools = [ordered]@{}
foreach ($tool in @('git.exe', 'node.exe', 'npm.cmd', 'java.exe', 'javac.exe', 'adb.exe')) {
    $arguments = @('--version')
    if ($tool -in @('java.exe', 'javac.exe')) { $arguments = @('-version') }
    if ($tool -eq 'adb.exe') { $arguments = @('version') }
    $report.tools[$tool] = Get-ToolVersion -Executable $tool -ToolArguments $arguments
}

# Scope existing desktop Rust paths to this process only; never change defaults.
$oldCargo = $env:CARGO_HOME
$oldRustup = $env:RUSTUP_HOME
try {
    if (Test-Path 'E:\xiaoheng-tools\cargo\bin\rustup.exe') {
        $env:CARGO_HOME = 'E:\xiaoheng-tools\cargo'
        $env:RUSTUP_HOME = 'E:\xiaoheng-tools\rustup'
        $report.tools.cargo = Get-ToolVersion 'E:\xiaoheng-tools\cargo\bin\cargo.exe'
        $report.tools.rustc = Get-ToolVersion 'E:\xiaoheng-tools\cargo\bin\rustc.exe'
        $report.tools.rustTargets = Get-ToolVersion 'E:\xiaoheng-tools\cargo\bin\rustup.exe' @('target', 'list', '--installed')
    } else {
        $report.tools.cargo = Get-ToolVersion 'cargo.exe'
        $report.tools.rustTargets = Get-ToolVersion 'rustup.exe' @('target', 'list', '--installed')
    }
} finally {
    $env:CARGO_HOME = $oldCargo
    $env:RUSTUP_HOME = $oldRustup
}

$report.androidLocations = @()
$sdkCandidates = @($env:ANDROID_HOME, $env:ANDROID_SDK_ROOT, "$env:LOCALAPPDATA\Android\Sdk", 'C:\Android\Sdk', 'E:\Android\Sdk') | Where-Object { $_ } | Select-Object -Unique
foreach ($sdk in $sdkCandidates) {
    $entry = [ordered]@{ path = $sdk; exists = (Test-Path $sdk) }
    foreach ($component in @('platforms', 'build-tools', 'ndk', 'cmdline-tools', 'system-images')) {
        $componentPath = Join-Path $sdk $component
        $entry[$component] = @(Get-ChildItem $componentPath -Directory -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Name)
    }
    $entry.adb = Get-ToolVersion (Join-Path $sdk 'platform-tools\adb.exe') @('version')
    $entry.emulatorAcceleration = Get-ToolVersion (Join-Path $sdk 'emulator\emulator.exe') @('-accel-check')
    $report.androidLocations += $entry
}
$report.studioLocations = @()
foreach ($studio in @('C:\Program Files\Android\Android Studio', 'C:\Android\android-studio', 'E:\Android\android-studio')) {
    $report.studioLocations += @{ path = $studio; exists = (Test-Path $studio); java = (Get-ToolVersion (Join-Path $studio 'jbr\bin\java.exe') @('-version')) }
}
$report.javaHome = $env:JAVA_HOME
$report.ndkHome = $env:NDK_HOME

$parent = Split-Path -Parent $OutputPath
if ($parent) { New-Item -ItemType Directory -Path $parent -Force -ErrorAction Stop | Out-Null }
$report | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $OutputPath -Encoding UTF8 -ErrorAction Stop
Write-Output "Inventory written to: $OutputPath"
Write-Output 'Review unknown and not-found entries; no SDK or device build was performed.'
