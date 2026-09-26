$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$androidRoot = Join-Path $repoRoot "android"
$unsignedAab = Join-Path $androidRoot "app\build\outputs\bundle\release\app-release.aab"
$androidStudioJdk = "C:\Program Files\Android\Android Studio\jbr"

if (-not (Get-Command java -ErrorAction SilentlyContinue)) {
    $bundledJava = Join-Path $androidStudioJdk "bin\java.exe"
    if (Test-Path -LiteralPath $bundledJava) {
        $env:JAVA_HOME = $androidStudioJdk
        $env:Path = "$(Join-Path $androidStudioJdk 'bin');$env:Path"
    }
}

function Invoke-CheckedStep {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][scriptblock]$Action
    )

    Write-Host "`n== $Name ==" -ForegroundColor Cyan
    & $Action
    if ($LASTEXITCODE -ne 0) {
        throw "$Name failed (exit code: $LASTEXITCODE)."
    }
}

Push-Location $repoRoot
try {
    Invoke-CheckedStep "Release lineage, branch, and version preflight" {
        node tools/android/release-guard.mjs --stage preflight
    }
    Invoke-CheckedStep "Type check" { npm.cmd run typecheck }
    Invoke-CheckedStep "Foundation tests" { npm.cmd run test:foundation }
    Invoke-CheckedStep "Dual-write tests" { npm.cmd run test:dual-write }
    Invoke-CheckedStep "App-review tests" { npm.cmd run test:app-review }
    Invoke-CheckedStep "Android release guard tests" { npm.cmd run test:android-release }

    # 어느 커밋으로 만든 빌드인지 번들 안에 심는다.
    #
    # 빌드 번호만으로는 "그 번호에 무엇이 들어 있었나" 를 나중에 알 수 없다.
    # 릴리스 커밋은 번호만 올리므로 git 로그를 봐도 번호와 기능이 이어지지 않고,
    # 스토어에 올라간 뒤에는 되짚을 방법이 없다 -- 실제로 "60 에 사진 고침이
    # 들어갔나" 를 되짚어야 했다.
    #
    # tools/android/build-aab.mjs 와 같은 이름이고, App.jsx 의
    # RELEASE_COMMIT_SHORT 가 버전 줄에 붙여 보여 준다. 두 경로 중 한쪽만
    # 심으면 Play 에 올라간 빌드에만 커밋이 없다 -- 실제로 61 이 그랬다.
    $gradleText = Get-Content -Raw (Join-Path $androidRoot "app\build.gradle")
    if ($gradleText -match 'versionName\s+"([^"]+)"') { $env:VITE_APP_VERSION = $Matches[1] }
    if ($gradleText -match 'versionCode\s+(\d+)') { $env:VITE_BUILD_NUMBER = $Matches[1] }
    $env:VITE_BUILD_COMMIT = (& git rev-parse HEAD).Trim()
    $env:VITE_BUILD_BRANCH = (& git rev-parse --abbrev-ref HEAD).Trim()
    Write-Host "  빌드에 심는 커밋: $($env:VITE_BUILD_COMMIT.Substring(0,7)) ($env:VITE_BUILD_BRANCH)"

    Invoke-CheckedStep "Production web build" { npm.cmd run build }
    Invoke-CheckedStep "Capacitor Android sync" { npx.cmd cap sync android }
    Invoke-CheckedStep "Web-to-Android asset verification" {
        node tools/android/release-guard.mjs --stage assets
    }

    Push-Location $androidRoot
    try {
        Invoke-CheckedStep "Android App Bundle build" { .\gradlew.bat bundleRelease }
    }
    finally {
        Pop-Location
    }

    if (-not (Test-Path -LiteralPath $unsignedAab)) {
        throw "Generated AAB was not found: $unsignedAab"
    }

    Write-Host "`nRelease build completed." -ForegroundColor Green
    Write-Host "Unsigned AAB: $unsignedAab"
    Write-Host "After signing, run the mandatory final verification:"
    Write-Host "npm run android:release:verify -- <signed-aab-path>"
}
finally {
    Pop-Location
}
