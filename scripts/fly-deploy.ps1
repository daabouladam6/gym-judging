# Correct Fly deploy: builds a NEW image from this repo's Dockerfile (matches PORT 8080 in fly.toml).
# Do NOT add --image ... — that reuses an old image and causes "not listening on 0.0.0.0:8080" / health timeouts.
$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")
fly deploy --config fly.toml @args
