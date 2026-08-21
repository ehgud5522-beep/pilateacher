$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$androidRoot = Join-Path $repoRoot "android"
$unsignedAab = Join-Path $androidRoot "app\build\outputs\bundle\release\app-release.aab"

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
