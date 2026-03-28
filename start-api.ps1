Set-Location "$PSScriptRoot\apps\api"

# Load .env from repo root
Get-Content "$PSScriptRoot\.env" | ForEach-Object {
    if ($_ -match '^([^#][^=]*)=(.*)$') {
        [System.Environment]::SetEnvironmentVariable($matches[1].Trim(), $matches[2].Trim())
    }
}

pnpm dev
