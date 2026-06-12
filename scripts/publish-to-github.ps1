#Requires -Version 5.1
<#
  Creates a GitHub repo (private) and pushes main, after you run: gh auth login
  Usage (from repo root): .\scripts\publish-to-github.ps1
                          .\scripts\publish-to-github.ps1 -RepoName "my-app" -Public
#>
param(
  [string] $RepoName = "gym-judging",
  [switch] $Public
)

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $RepoRoot

$gh = Join-Path $env:ProgramFiles "GitHub CLI\gh.exe"
if (-not (Test-Path $gh)) {
  Write-Error "GitHub CLI not found at $gh. Install from https://cli.github.com/ or winget install GitHub.cli"
}

& $gh auth status 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {
  Write-Host ""
  Write-Host "Not logged in to GitHub. Run this first, then re-run this script:" -ForegroundColor Yellow
  Write-Host "  & `"$gh`" auth login" -ForegroundColor Cyan
  Write-Host ""
  exit 1
}

$visibility = if ($Public) { "--public" } else { "--private" }

$url = git remote get-url origin 2>$null
$hasOrigin = [string]::IsNullOrWhiteSpace($url) -eq $false

if ($hasOrigin) {
  Write-Host "Remote 'origin' already exists. Pushing main..." -ForegroundColor Green
  git push -u origin main
} else {
  Write-Host "Creating GitHub repo '$RepoName' and pushing..." -ForegroundColor Green
  & $gh repo create $RepoName $visibility --source=. --remote=origin --push --description "Gym judging app (React + Fastify + SQLite)"
}

Write-Host ""
Write-Host "Done. View repo:" -ForegroundColor Green
& $gh repo view --web 2>$null
if ($LASTEXITCODE -ne 0) {
  $user = (& $gh api user --jq .login 2>$null | Out-String).Trim()
  if ($user) {
    Write-Host "  https://github.com/$user/$RepoName" -ForegroundColor Cyan
  }
}
