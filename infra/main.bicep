// OMMA — Azure Infrastructure
// Deploy with: az deployment group create --resource-group rg-omma-prod --template-file infra/main.bicep --parameters @infra/parameters.json

@description('Location for all resources')
param location string = resourceGroup().location

@description('Environment name (prod, staging)')
param environment string = 'prod'

@description('PostgreSQL admin username')
param dbAdminUser string = 'ommaadmin'

@description('PostgreSQL admin password')
@secure()
param dbAdminPassword string

@description('JWT secret key for FastAPI')
@secure()
param secretKey string

@description('Anthropic API key')
@secure()
param anthropicApiKey string

@description('OpenAI API key')
@secure()
param openaiApiKey string

var prefix = 'omma-${environment}'
var acrName = 'ommaacr${environment}'
var dbServerName = '${prefix}-db'
var redisName = '${prefix}-redis'
var containerEnvName = '${prefix}-env'
var apiAppName = '${prefix}-api'
var workerAppName = '${prefix}-worker'
var swaName = '${prefix}-web'
var logWorkspaceName = '${prefix}-logs'

// ─── Log Analytics Workspace ──────────────────────────────────────────────────
resource logWorkspace 'Microsoft.OperationalInsights/workspaces@2022-10-01' = {
  name: logWorkspaceName
  location: location
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: 30
  }
}

// ─── Azure Container Registry ─────────────────────────────────────────────────
resource acr 'Microsoft.ContainerRegistry/registries@2023-07-01' = {
  name: acrName
  location: location
  sku: { name: 'Basic' }
  properties: {
    adminUserEnabled: true
  }
}

// ─── Azure Database for PostgreSQL Flexible Server ────────────────────────────
resource dbServer 'Microsoft.DBforPostgreSQL/flexibleServers@2023-06-01-preview' = {
  name: dbServerName
  location: location
  sku: {
    name: 'Standard_B1ms'
    tier: 'Burstable'
  }
  properties: {
    administratorLogin: dbAdminUser
    administratorLoginPassword: dbAdminPassword
    version: '16'
    storage: { storageSizeGB: 32 }
    backup: { backupRetentionDays: 7, geoRedundantBackup: 'Disabled' }
    highAvailability: { mode: 'Disabled' }
  }
}

resource ommaDatabase 'Microsoft.DBforPostgreSQL/flexibleServers/databases@2023-06-01-preview' = {
  parent: dbServer
  name: 'omma_db'
  properties: { charset: 'UTF8', collation: 'en_US.utf8' }
}

// Allow Azure services to connect
resource dbFirewallRule 'Microsoft.DBforPostgreSQL/flexibleServers/firewallRules@2023-06-01-preview' = {
  parent: dbServer
  name: 'AllowAzureServices'
  properties: {
    startIpAddress: '0.0.0.0'
    endIpAddress: '0.0.0.0'
  }
}

// pgvector must be enabled via az CLI after deployment:
// az postgres flexible-server parameter set --resource-group rg-omma-prod --server-name omma-prod-db --name shared_preload_libraries --value pg_vector

// ─── Azure Cache for Redis ────────────────────────────────────────────────────
resource redis 'Microsoft.Cache/redis@2023-08-01' = {
  name: redisName
  location: location
  properties: {
    sku: { name: 'Basic', family: 'C', capacity: 0 }
    enableNonSslPort: false
    minimumTlsVersion: '1.2'
  }
}

// ─── Container Apps Environment ───────────────────────────────────────────────
resource containerEnv 'Microsoft.App/managedEnvironments@2023-05-01' = {
  name: containerEnvName
  location: location
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logWorkspace.properties.customerId
        sharedKey: logWorkspace.listKeys().primarySharedKey
      }
    }
  }
}

// Shared env vars for all container apps
var sharedEnvVars = [
  { name: 'DATABASE_URL', value: 'postgresql+asyncpg://${dbAdminUser}:${dbAdminPassword}@${dbServer.properties.fullyQualifiedDomainName}:5432/omma_db' }
  { name: 'REDIS_URL', value: 'rediss://:${redis.listKeys().primaryKey}@${redis.properties.hostName}:6380/0' }
  { name: 'SECRET_KEY', secretRef: 'secret-key' }
  { name: 'ANTHROPIC_API_KEY', secretRef: 'anthropic-api-key' }
  { name: 'OPENAI_API_KEY', secretRef: 'openai-api-key' }
  { name: 'ENVIRONMENT', value: 'production' }
  { name: 'EMBEDDING_MODEL', value: 'all-MiniLM-L6-v2' }
  { name: 'COMPLIANCE_THRESHOLD', value: '0.70' }
]

var secrets = [
  { name: 'secret-key', value: secretKey }
  { name: 'anthropic-api-key', value: anthropicApiKey }
  { name: 'openai-api-key', value: openaiApiKey }
  { name: 'acr-password', value: acr.listCredentials().passwords[0].value }
]

// ─── API Container App ─────────────────────────────────────────────────────────
resource apiApp 'Microsoft.App/containerApps@2023-05-01' = {
  name: apiAppName
  location: location
  properties: {
    managedEnvironmentId: containerEnv.id
    configuration: {
      secrets: secrets
      registries: [
        {
          server: acr.properties.loginServer
          username: acr.name
          passwordSecretRef: 'acr-password'
        }
      ]
      ingress: {
        external: true
        targetPort: 8000
        transport: 'http'
        corsPolicy: {
          allowedOrigins: ['*']
          allowedMethods: ['*']
          allowedHeaders: ['*']
          allowCredentials: false
        }
      }
    }
    template: {
      containers: [
        {
          name: 'omma-api'
          image: '${acr.properties.loginServer}/omma-api:latest'
          resources: { cpu: json('0.5'), memory: '1Gi' }
          env: sharedEnvVars
        }
      ]
      scale: {
        minReplicas: 1
        maxReplicas: 3
        rules: [
          {
            name: 'http-scaling'
            http: { metadata: { concurrentRequests: '50' } }
          }
        ]
      }
    }
  }
}

// ─── Celery Worker Container App ──────────────────────────────────────────────
resource workerApp 'Microsoft.App/containerApps@2023-05-01' = {
  name: workerAppName
  location: location
  properties: {
    managedEnvironmentId: containerEnv.id
    configuration: {
      secrets: secrets
      registries: [
        {
          server: acr.properties.loginServer
          username: acr.name
          passwordSecretRef: 'acr-password'
        }
      ]
    }
    template: {
      containers: [
        {
          name: 'omma-worker'
          image: '${acr.properties.loginServer}/omma-api:latest'
          command: ['celery', '-A', 'tasks.celery_app:celery_app', 'worker', '--loglevel=info']
          resources: { cpu: json('0.5'), memory: '1Gi' }
          env: sharedEnvVars
        }
      ]
      scale: {
        minReplicas: 1
        maxReplicas: 2
      }
    }
  }
}

// ─── Azure Static Web Apps ────────────────────────────────────────────────────
resource staticWebApp 'Microsoft.Web/staticSites@2023-01-01' = {
  name: swaName
  location: 'eastus2'  // SWA has limited region support; eastus2 is widely available
  sku: { name: 'Free', tier: 'Free' }
  properties: {
    repositoryUrl: 'https://github.com/tresajoby/opulanz-ai-marketing-agent'
    branch: 'main'
    buildProperties: {
      appLocation: 'web'
      outputLocation: '.next'
    }
  }
}

// ─── Outputs ─────────────────────────────────────────────────────────────────
output apiUrl string = 'https://${apiApp.properties.configuration.ingress.fqdn}'
output acrLoginServer string = acr.properties.loginServer
output staticWebAppUrl string = 'https://${staticWebApp.properties.defaultHostname}'
output staticWebAppApiToken string = staticWebApp.listSecrets().properties.apiKey
output dbHostname string = dbServer.properties.fullyQualifiedDomainName
output redisPrimaryKey string = redis.listKeys().primaryKey
output redisHostname string = redis.properties.hostName
