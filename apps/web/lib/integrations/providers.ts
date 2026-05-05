export type ProviderKey =
  | 'google'
  | 'microsoft'
  | 'slack'
  | 'hubspot'
  | 'notion'
  | 'jira'
  | 'confluence'
  | 'salesforce'
  | 'snowflake'
  | 'github'
  | 'linear'
  | 'zendesk';

export interface ProviderCapabilities {
  canFetch: boolean;
  canSearch: boolean;
  requiresScopes: string[];
}

export interface ProviderConfig {
  key: ProviderKey;
  displayName: string;
  description: string;
  icon: string;
  category: string;
  nangoIntegrationId: string;
  resources: string[];
  capabilities: ProviderCapabilities;
}

export const PROVIDER_REGISTRY: Record<ProviderKey, ProviderConfig> = {
  google: {
    key: 'google',
    displayName: 'Google Workspace',
    description: 'Gmail, Drive, Calendar',
    icon: '/integrations/gdrive.svg',
    category: 'productivity',
    nangoIntegrationId: 'google',
    resources: ['gmail', 'drive', 'calendar'],
    capabilities: {
      canFetch: true,
      canSearch: true,
      requiresScopes: ['gmail.readonly', 'drive.readonly', 'calendar.readonly'],
    },
  },
  microsoft: {
    key: 'microsoft',
    displayName: 'Microsoft 365',
    description: 'Outlook, OneDrive, SharePoint, Calendar',
    icon: '/integrations/outlook.svg',
    category: 'productivity',
    nangoIntegrationId: 'microsoft',
    resources: ['emails', 'files', 'documents', 'events'],
    capabilities: {
      canFetch: true,
      canSearch: true,
      requiresScopes: ['Mail.Read', 'Files.Read.All', 'Sites.Read.All', 'Calendars.Read'],
    },
  },
  slack: {
    key: 'slack',
    displayName: 'Slack',
    description: 'Channels and threads',
    icon: '/integrations/slack.svg',
    category: 'communication',
    nangoIntegrationId: 'slack',
    resources: ['channels', 'threads'],
    capabilities: {
      canFetch: true,
      canSearch: true,
      requiresScopes: ['channels:history', 'channels:read'],
    },
  },
  hubspot: {
    key: 'hubspot',
    displayName: 'HubSpot',
    description: 'Contacts, Companies, Deals, Notes',
    icon: '/integrations/hubspot.svg',
    category: 'crm',
    nangoIntegrationId: 'hubspot',
    resources: ['contacts', 'companies', 'deals', 'notes'],
    capabilities: {
      canFetch: true,
      canSearch: true,
      requiresScopes: ['crm.objects.contacts.read'],
    },
  },
  notion: {
    key: 'notion',
    displayName: 'Notion',
    description: 'Pages and databases',
    icon: '/integrations/notion.svg',
    category: 'productivity',
    nangoIntegrationId: 'notion',
    resources: ['pages', 'databases'],
    capabilities: {
      canFetch: true,
      canSearch: true,
      requiresScopes: [],
    },
  },
  jira: {
    key: 'jira',
    displayName: 'Jira',
    description: 'Issues and comments',
    icon: '/integrations/jira.svg',
    category: 'dev',
    nangoIntegrationId: 'jira',
    resources: ['issues', 'comments'],
    capabilities: {
      canFetch: true,
      canSearch: true,
      requiresScopes: ['read:jira-work'],
    },
  },
  confluence: {
    key: 'confluence',
    displayName: 'Confluence',
    description: 'Pages and spaces',
    icon: '/integrations/confluence.svg',
    category: 'productivity',
    nangoIntegrationId: 'confluence',
    resources: ['pages', 'spaces'],
    capabilities: {
      canFetch: true,
      canSearch: true,
      requiresScopes: ['read:confluence-content.summary'],
    },
  },
  salesforce: {
    key: 'salesforce',
    displayName: 'Salesforce',
    description: 'Accounts, Opportunities, Cases',
    icon: '/integrations/salesforce.svg',
    category: 'crm',
    nangoIntegrationId: 'salesforce',
    resources: ['accounts', 'opportunities', 'cases'],
    capabilities: {
      canFetch: true,
      canSearch: true,
      requiresScopes: ['api', 'refresh_token', 'offline_access'],
    },
  },
  snowflake: {
    key: 'snowflake',
    displayName: 'Snowflake',
    description: 'Tables and views',
    icon: '/integrations/snowflake.svg',
    category: 'data',
    nangoIntegrationId: 'snowflake',
    resources: ['tables', 'views'],
    capabilities: {
      canFetch: true,
      canSearch: true,
      requiresScopes: [],
    },
  },
  github: {
    key: 'github',
    displayName: 'GitHub',
    description: 'Issues, PRs, Wiki',
    icon: '/integrations/github.svg',
    category: 'dev',
    nangoIntegrationId: 'github',
    resources: ['issues', 'prs', 'wiki'],
    capabilities: {
      canFetch: true,
      canSearch: true,
      requiresScopes: ['repo', 'read:user'],
    },
  },
  linear: {
    key: 'linear',
    displayName: 'Linear',
    description: 'Issues, projects, cycles',
    icon: '/integrations/linear.svg',
    category: 'dev',
    nangoIntegrationId: 'linear',
    resources: ['issues', 'projects', 'cycles'],
    capabilities: {
      canFetch: true,
      canSearch: true,
      requiresScopes: ['read'],
    },
  },
  zendesk: {
    key: 'zendesk',
    displayName: 'Zendesk',
    description: 'Tickets and articles',
    icon: '/integrations/zendesk.svg',
    category: 'crm',
    nangoIntegrationId: 'zendesk',
    resources: ['tickets', 'articles'],
    capabilities: {
      canFetch: true,
      canSearch: true,
      requiresScopes: ['tickets:read', 'help_center:read'],
    },
  },
};

export function getProviderConfig(key: ProviderKey): ProviderConfig {
  return PROVIDER_REGISTRY[key];
}

export function getProvidersByCategory(category: string): ProviderConfig[] {
  return Object.values(PROVIDER_REGISTRY).filter((p) => p.category === category);
}

export function getAllProviders(): ProviderConfig[] {
  return Object.values(PROVIDER_REGISTRY);
}
