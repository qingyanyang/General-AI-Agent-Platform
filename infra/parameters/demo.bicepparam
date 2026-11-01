using '../main.bicep'

param location = 'australiasoutheast'
param staticWebAppLocation = 'eastasia'
param environment = 'demo'
param prefix = 'eap'

param tags = {
  project: 'enterprise-ai-agent-platform'
  environment: 'demo'
  managedBy: 'bicep'
}

// Dual-path secrets (empty defaults are for CI file-eval only — do not deploy with empties).
// Local: export DATABASE_URL / LLM_API_KEY, then run infra/scripts/validate-deploy-secrets.sh.
// CI:    infra-cd.yml validates, then --parameters overrides.
// Gates: Phase 1 needs no secrets. When deployContainerApp=true require DATABASE_URL + LLM_API_KEY
//        and a non-empty public GHCR containerImage.
//
// DATABASE_URL: use Supabase *session pooler* connection string (IPv4-friendly), e.g.
//   postgresql+psycopg://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres
// Prefer building/encoding the URL in your secret store; never commit it.
param databaseUrl = readEnvironmentVariable('DATABASE_URL', '')
param llmApiKey = readEnvironmentVariable('LLM_API_KEY', '')
param postgresSchema = 'agent_platform'

// Phase 1: false — no Container App until a public GHCR image exists.
// Phase 2: set true + containerImage = 'ghcr.io/<github-username>/agent-platform-api:<tag>'
param deployContainerApp = false
param containerImage = ''

param containerCpu = '0.25'
param containerMemory = '0.5Gi'
param minReplicas = 0
param maxReplicas = 2

param corsAllowedOrigins = [
  'http://localhost:5173'
]

param staticWebAppSkuName = 'Free'
