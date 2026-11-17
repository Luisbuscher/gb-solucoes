$ErrorActionPreference = 'Stop'
$projectDir = Split-Path -Parent $PSScriptRoot
Push-Location (Join-Path $projectDir 'backend')
try {
  if (-not (Test-Path -LiteralPath '.env')) { throw 'Crie backend/.env a partir do exemplo e preencha as credenciais e chaves.' }
  npm ci
  if ($LASTEXITCODE -ne 0) { throw 'Falha ao instalar dependências operacionais.' }
  node scripts/prepare-database.mjs
  if ($LASTEXITCODE -ne 0) { throw 'Falha ao preparar banco.' }
} finally { Pop-Location }
Push-Location $projectDir
try { docker compose up -d --build; if ($LASTEXITCODE -ne 0) { throw 'Falha no Docker Compose.' } } finally { Pop-Location }
