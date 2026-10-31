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
// Local: export vars, then run infra/scripts/validate-deploy-secrets.sh before az deploy.
// CI:    infra-cd.yml validates, then --parameters overrides (see infra-cd.yml).
// Gates: always require POSTGRES_ADMIN_PASSWORD; when deployContainerApp=true also require
//        POSTGRES_APP_PASSWORD + LLM_API_KEY (and a non-empty containerImage).
param postgresAdminLogin = 'pgadmin'
param postgresAdminPassword = readEnvironmentVariable('POSTGRES_ADMIN_PASSWORD', '')

param postgresAppLogin = 'eap_app'
param postgresAppPassword = readEnvironmentVariable('POSTGRES_APP_PASSWORD', '')

param llmApiKey = readEnvironmentVariable('LLM_API_KEY', '')

param postgresVersion = '16'
param postgresSkuName = 'Standard_B1ms'
param postgresSkuTier = 'Burstable'
param postgresStorageSizeGb = 32
param postgresBackupRetentionDays = 7
param postgresDatabaseName = 'agent_platform_db'

// WARNING (public demo only): 0.0.0.0–0.0.0.0 Allow Azure services — broader than the name implies.
// Any Azure IP may attempt auth; mitigate with TLS + strong passwords + app_user least privilege.
// Future staging/production .bicepparam files MUST set allowAzureServicesAccess = false
// and use VNet-integrated CAE + private Postgres, or a static-egress IP allowlist.
param allowAzureServicesAccess = true

param postgresFirewallRules = []

// Phase 1: false — UAMI + AcrPull still created; no Container App until image exists.
// Phase 2: after first FastAPI image is in ACR AND app_user is created, set true + containerImage.
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
param acrSkuName = 'Basic'
