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

// Dual-path secrets (empty defaults are for CI file-eval only — do not deploy with empty DATABASE_URL).
// Local: export DATABASE_URL (and optionally LLM_API_KEY / LANGSMITH_API_KEY), then validate-deploy-secrets.sh.
// CI:    infra-cd.yml validates, then --parameters overrides.
// Gates: Phase 1 needs no secrets. When deployContainerApp=true require DATABASE_URL
//        and a non-empty public GHCR containerImage.
// Optional: LLM_API_KEY, LANGSMITH_API_KEY (scripts set enable* flags when present).
//
// DATABASE_URL: use Supabase *session pooler* connection string (IPv4-friendly), e.g.
//   postgresql+psycopg://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres
// Prefer building/encoding the URL in your secret store; never commit it.
//
// Demo uses DeepSeek (OpenAI-compatible). LLM_API_KEY secret must be a DeepSeek key.
// LangSmith: APAC endpoint; project is agent-platform-demo (from ENVIRONMENT=demo, not a Bicep param).
param databaseUrl = readEnvironmentVariable('DATABASE_URL', '')
param llmApiKey = readEnvironmentVariable('LLM_API_KEY', '')
// Non-secure gates: empty(@secure()) is unreliable in ARM, so scripts/CI set these explicitly.
param enableLlmApiKey = false
param llmProvider = 'deepseek'
param llmModel = ''
param llmBaseUrl = ''
param langsmithApiKey = readEnvironmentVariable('LANGSMITH_API_KEY', '')
param enableLangsmithTracing = false
param langsmithEndpoint = 'https://apac.api.smith.langchain.com'
param postgresSchema = 'agent_platform'

// Non-secret Auth0 API settings (protected routes return 503 without them).
param auth0Domain = 'dev-pf7wi26tb5bj8qxz.us.auth0.com'
param auth0Audience = 'https://api.agent-platform'
// Management API invites: CI/local deploy sets enableAuth0Management=true when AUTH0_MGMT_* secrets exist.
param auth0MgmtClientId = readEnvironmentVariable('AUTH0_MGMT_CLIENT_ID', '')
param auth0MgmtClientSecret = readEnvironmentVariable('AUTH0_MGMT_CLIENT_SECRET', '')
param enableAuth0Management = false
param auth0DbConnection = 'Username-Password-Authentication'

// Phase 1: false — no Container App until a public GHCR image exists.
// Phase 2: set true + containerImage = 'ghcr.io/<github-username>/agent-platform-api:<tag>'
param deployContainerApp = true
param containerImage = 'ghcr.io/qingyanyang/agent-platform-api:latest'

param containerCpu = '0.25'
param containerMemory = '0.5Gi'
param minReplicas = 0
param maxReplicas = 2

// The Static Web App URL is added automatically in main.bicep.
param corsAllowedOrigins = [
  'http://localhost:5173'
]

param staticWebAppSkuName = 'Free'
