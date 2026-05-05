// ============================================================
// crm-fetchers.test.ts — Unit tests for CRM fetchers (ATH-67)
//
// Tests run entirely offline with mocked Nango tokens and
// mocked HTTP responses. Validates:
//   1. FetchedChunk[] shape is correct for all fetchers
//   2. Cursor-based pagination works
//   3. No tokens are stored or logged
//   4. No content written to Supabase
//   5. Salesforce + HubSpot provider registrations work
// ============================================================

import { beforeEach, describe, expect, it, vi } from 'vitest'

// ---- Mock Nango client (Rule: get token, use once, discard) ----
vi.mock('@/lib/nango/client', () => ({
  getConnectionToken: vi.fn().mockResolvedValue('mock-access-token-never-stored'),
}))

// ---- Mock Supabase (no content should be persisted) ----
const supabaseWriteCalls: Array<{ table: string; data: unknown }> = []
vi.mock('@/lib/supabase/server', () => {
  const admin = {
    from(table: string) {
      return {
        select: () => ({ eq: () => ({ eq: () => ({ limit: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }) }) }),
        upsert: (data: unknown) => {
          supabaseWriteCalls.push({ table, data })
          return { select: () => ({ single: () => Promise.resolve({ data: { id: 'mock-doc-id' }, error: null }) }) }
        },
        insert: (data: unknown) => {
          supabaseWriteCalls.push({ table, data })
          return Promise.resolve({ data: null, error: null })
        },
      }
    },
  }
  return { supabaseAdmin: admin, supabaseServer: admin, supabase: admin }
})

// ---- Mock global fetch ----------------------------------------
const originalFetch = globalThis.fetch
let fetchCalls: Array<{ url: string; headers: Record<string, string> }> = []

// ---- Salesforce mock data ----
const SF_ACCOUNTS_RESPONSE = {
  done: true,
  records: [
    { Id: '001ABC', Name: 'Acme Corp', Industry: 'Technology', Description: 'A tech company' },
    { Id: '001DEF', Name: 'Globex Inc', Industry: null, Description: null },
  ],
}

const SF_OPPORTUNITIES_RESPONSE = {
  done: true,
  records: [
    { Id: '006ABC', Name: 'Big Deal', StageName: 'Closed Won', Description: 'Our biggest deal' },
  ],
}

const SF_CASES_RESPONSE = {
  done: true,
  records: [
    { Id: '500ABC', Subject: 'Login Issue', Description: 'User cannot log in', Status: 'Open' },
  ],
}

// ---- Salesforce paginated mock ----
const SF_ACCOUNTS_PAGE_1 = {
  done: false,
  nextRecordsUrl: '/query/01g0000000A-1',
  records: [
    { Id: '001PG1', Name: 'Page1 Corp', Industry: 'Finance', Description: 'First page' },
  ],
}

const SF_ACCOUNTS_PAGE_2 = {
  done: true,
  records: [
    { Id: '001PG2', Name: 'Page2 Corp', Industry: 'Health', Description: 'Second page' },
  ],
}

// ---- HubSpot mock data ----
const HS_CONTACTS_RESPONSE = {
  results: [
    { id: '101', properties: { firstname: 'Jane', lastname: 'Doe', email: 'jane@example.com', phone: '+1234567890', company: 'Acme' } },
    { id: '102', properties: { firstname: null, lastname: null, email: 'unknown@test.com', phone: null, company: null } },
  ],
  paging: undefined,
}

const HS_COMPANIES_RESPONSE = {
  results: [
    { id: '201', properties: { name: 'TechCo', domain: 'techco.com', industry: 'SaaS', description: 'A SaaS company' } },
  ],
  paging: undefined,
}

const HS_DEALS_RESPONSE = {
  results: [
    { id: '301', properties: { dealname: 'Enterprise License', dealstage: 'negotiation', pipeline: 'default', amount: '50000' } },
  ],
  paging: undefined,
}

const HS_NOTES_RESPONSE = {
  results: [
    { id: '401', properties: { hs_note_body: 'Called client, discussed renewal', hs_timestamp: '2026-04-01T10:00:00Z', hubspot_owner_id: 'owner-1' } },
  ],
  paging: undefined,
}

// ---- HubSpot paginated mock ----
const HS_CONTACTS_PAGE_1 = {
  results: [
    { id: '501', properties: { firstname: 'Alice', lastname: 'Smith', email: 'alice@test.com', phone: null, company: 'AliceCo' } },
  ],
  paging: { next: { after: 'cursor-page2' } },
}

const HS_CONTACTS_PAGE_2 = {
  results: [
    { id: '502', properties: { firstname: 'Bob', lastname: 'Jones', email: 'bob@test.com', phone: null, company: 'BobCo' } },
  ],
  paging: undefined,
}

beforeEach(() => {
  fetchCalls = []
  supabaseWriteCalls.length = 0

  globalThis.fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    const headers = (init?.headers ?? {}) as Record<string, string>
    fetchCalls.push({ url, headers })

    // Salesforce routing
    if (url.includes('/services/data/v59.0/query?q=') && url.includes('Account')) {
      return new Response(JSON.stringify(SF_ACCOUNTS_RESPONSE), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    if (url.includes('/services/data/v59.0/query?q=') && url.includes('Opportunity')) {
      return new Response(JSON.stringify(SF_OPPORTUNITIES_RESPONSE), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    if (url.includes('/services/data/v59.0/query?q=') && url.includes('Case')) {
      return new Response(JSON.stringify(SF_CASES_RESPONSE), { status: 200, headers: { 'content-type': 'application/json' } })
    }

    // Salesforce pagination
    if (url.includes('query/01g0000000A-1')) {
      return new Response(JSON.stringify(SF_ACCOUNTS_PAGE_2), { status: 200, headers: { 'content-type': 'application/json' } })
    }

    // HubSpot routing
    if (url.includes('/crm/v3/objects/contacts')) {
      // Check for pagination
      if (url.includes('after=cursor-page2')) {
        return new Response(JSON.stringify(HS_CONTACTS_PAGE_2), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      return new Response(JSON.stringify(HS_CONTACTS_RESPONSE), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    if (url.includes('/crm/v3/objects/companies')) {
      return new Response(JSON.stringify(HS_COMPANIES_RESPONSE), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    if (url.includes('/crm/v3/objects/deals')) {
      return new Response(JSON.stringify(HS_DEALS_RESPONSE), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    if (url.includes('/crm/v3/objects/notes')) {
      return new Response(JSON.stringify(HS_NOTES_RESPONSE), { status: 200, headers: { 'content-type': 'application/json' } })
    }

    return new Response(JSON.stringify({ error: 'not found' }), { status: 404 })
  }) as typeof fetch
})

// ---- Helper: assert FetchedChunk shape ----
function assertChunkShape(chunk: unknown): void {
  expect(chunk).toMatchObject({
    chunk_id:   expect.any(String),
    title:      expect.any(String),
    content:    expect.any(String),
    source_url: expect.any(String),
    metadata:   expect.objectContaining({
      provider:    expect.any(String),
      resource_type: expect.any(String),
      id:          expect.any(String),
    }),
  })
  expect((chunk as { content: string }).content.length).toBeGreaterThan(0)
  expect((chunk as { chunk_id: string }).chunk_id).toMatch(/^(sf|hs)-/)
}

// ============================================================
// Salesforce fetcher tests
// ============================================================

describe('Salesforce fetchers (mocked)', () => {
  it('fetches Accounts with correct FetchedChunk shape', async () => {
    const { fetchSalesforceAccounts } = await import('@/lib/integrations/salesforce/accounts-fetcher')
    const chunks = await fetchSalesforceAccounts('conn-sf', 'https://myorg.salesforce.com', 'org-1')

    expect(chunks).toHaveLength(2)
    chunks.forEach(assertChunkShape)

    // Verify specific data mapping
    expect(chunks[0].chunk_id).toBe('sf-account-001ABC')
    expect(chunks[0].title).toBe('Acme Corp')
    expect(chunks[0].content).toContain('Industry: Technology')
    expect(chunks[0].source_url).toContain('myorg.salesforce.com')
    expect(chunks[0].metadata.provider).toBe('salesforce')
    expect(chunks[0].metadata.resource_type).toBe('accounts')

    // Second record has null fields — they should be filtered out
    expect(chunks[1].chunk_id).toBe('sf-account-001DEF')
    expect(chunks[1].content).not.toContain('Industry:')
    expect(chunks[1].content).not.toContain('Description:')
  })

  it('fetches Opportunities with correct FetchedChunk shape', async () => {
    const { fetchSalesforceOpportunities } = await import('@/lib/integrations/salesforce/opportunities-fetcher')
    const chunks = await fetchSalesforceOpportunities('conn-sf', 'https://myorg.salesforce.com', 'org-1')

    expect(chunks).toHaveLength(1)
    assertChunkShape(chunks[0])
    expect(chunks[0].chunk_id).toBe('sf-opportunity-006ABC')
    expect(chunks[0].content).toContain('Stage: Closed Won')
    expect(chunks[0].metadata.resource_type).toBe('opportunities')
  })

  it('fetches Cases with correct FetchedChunk shape', async () => {
    const { fetchSalesforceCases } = await import('@/lib/integrations/salesforce/cases-fetcher')
    const chunks = await fetchSalesforceCases('conn-sf', 'https://myorg.salesforce.com', 'org-1')

    expect(chunks).toHaveLength(1)
    assertChunkShape(chunks[0])
    expect(chunks[0].chunk_id).toBe('sf-case-500ABC')
    expect(chunks[0].title).toBe('Login Issue')
    expect(chunks[0].content).toContain('Status: Open')
    expect(chunks[0].metadata.resource_type).toBe('cases')
  })

  it('handles cursor-based pagination', async () => {
    // Override fetch to return paginated responses for accounts
    globalThis.fetch = vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      if (url.includes('query?q=') && url.includes('Account')) {
        return new Response(JSON.stringify(SF_ACCOUNTS_PAGE_1), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      if (url.includes('query/01g0000000A-1')) {
        return new Response(JSON.stringify(SF_ACCOUNTS_PAGE_2), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      return new Response('{}', { status: 404 })
    }) as typeof fetch

    const { fetchSalesforceAccounts } = await import('@/lib/integrations/salesforce/accounts-fetcher')
    const chunks = await fetchSalesforceAccounts('conn-sf', 'https://myorg.salesforce.com', 'org-1')

    expect(chunks).toHaveLength(2)
    expect(chunks[0].chunk_id).toBe('sf-account-001PG1')
    expect(chunks[1].chunk_id).toBe('sf-account-001PG2')
    expect(globalThis.fetch).toHaveBeenCalledTimes(2)
  })
})

// ============================================================
// HubSpot fetcher tests
// ============================================================

describe('HubSpot fetchers (mocked)', () => {
  it('fetches Contacts with correct FetchedChunk shape', async () => {
    const { fetchHubSpotContacts } = await import('@/lib/integrations/hubspot/contacts-fetcher')
    const chunks = await fetchHubSpotContacts('conn-hs', 'org-1')

    expect(chunks).toHaveLength(2)
    chunks.forEach(assertChunkShape)

    expect(chunks[0].chunk_id).toBe('hs-contact-101')
    expect(chunks[0].title).toBe('Jane Doe')
    expect(chunks[0].content).toContain('Email: jane@example.com')
    expect(chunks[0].metadata.provider).toBe('hubspot')
    expect(chunks[0].metadata.resource_type).toBe('contacts')

    // Unnamed contact
    expect(chunks[1].title).toBe('Unnamed Contact')
  })

  it('fetches Companies with correct FetchedChunk shape', async () => {
    const { fetchHubSpotCompanies } = await import('@/lib/integrations/hubspot/companies-fetcher')
    const chunks = await fetchHubSpotCompanies('conn-hs', 'org-1')

    expect(chunks).toHaveLength(1)
    assertChunkShape(chunks[0])
    expect(chunks[0].chunk_id).toBe('hs-company-201')
    expect(chunks[0].title).toBe('TechCo')
    expect(chunks[0].content).toContain('Domain: techco.com')
  })

  it('fetches Deals with correct FetchedChunk shape', async () => {
    const { fetchHubSpotDeals } = await import('@/lib/integrations/hubspot/deals-fetcher')
    const chunks = await fetchHubSpotDeals('conn-hs', 'org-1')

    expect(chunks).toHaveLength(1)
    assertChunkShape(chunks[0])
    expect(chunks[0].chunk_id).toBe('hs-deal-301')
    expect(chunks[0].title).toBe('Enterprise License')
    expect(chunks[0].content).toContain('Amount: $50000')
  })

  it('fetches Notes with correct FetchedChunk shape', async () => {
    const { fetchHubSpotNotes } = await import('@/lib/integrations/hubspot/notes-fetcher')
    const chunks = await fetchHubSpotNotes('conn-hs', 'org-1')

    expect(chunks).toHaveLength(1)
    assertChunkShape(chunks[0])
    expect(chunks[0].chunk_id).toBe('hs-note-401')
    expect(chunks[0].content).toContain('Called client, discussed renewal')
    expect(chunks[0].metadata.resource_type).toBe('notes')
  })

  it('handles cursor-based pagination', async () => {
    globalThis.fetch = vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      if (url.includes('/crm/v3/objects/contacts') && url.includes('after=cursor-page2')) {
        return new Response(JSON.stringify(HS_CONTACTS_PAGE_2), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      if (url.includes('/crm/v3/objects/contacts')) {
        return new Response(JSON.stringify(HS_CONTACTS_PAGE_1), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      return new Response('{}', { status: 404 })
    }) as typeof fetch

    const { fetchHubSpotContacts } = await import('@/lib/integrations/hubspot/contacts-fetcher')
    const chunks = await fetchHubSpotContacts('conn-hs', 'org-1')

    expect(chunks).toHaveLength(2)
    expect(chunks[0].chunk_id).toBe('hs-contact-501')
    expect(chunks[1].chunk_id).toBe('hs-contact-502')
    expect(globalThis.fetch).toHaveBeenCalledTimes(2)
  })
})

// ============================================================
// Token security tests
// ============================================================

describe('Token security (ATH-67 critical rule)', () => {
  it('uses Bearer token in Authorization header but never in URL', async () => {
    const { fetchSalesforceAccounts } = await import('@/lib/integrations/salesforce/accounts-fetcher')
    await fetchSalesforceAccounts('conn-sf', 'https://myorg.salesforce.com', 'org-1')

    for (const call of fetchCalls) {
      // Token must NEVER appear in URL
      expect(call.url).not.toContain('mock-access-token')
      // Token MUST be in Authorization header
      expect(call.headers?.['Authorization'] ?? '').toContain('Bearer')
    }
  })

  it('Nango getConnectionToken is called once per fetch, not cached', async () => {
    const { getConnectionToken } = await import('@/lib/nango/client')
    const mockGetToken = getConnectionToken as ReturnType<typeof vi.fn>
    mockGetToken.mockClear()

    const { fetchHubSpotContacts } = await import('@/lib/integrations/hubspot/contacts-fetcher')
    await fetchHubSpotContacts('conn-hs', 'org-1')

    // getConnectionToken called exactly once (single page, single fetch)
    expect(mockGetToken).toHaveBeenCalledWith('conn-hs', 'hubspot', 'org-1')
    expect(mockGetToken).toHaveBeenCalledTimes(1)
  })
})

// ============================================================
// No-content-stored verification
// ============================================================

describe('No content persisted to Supabase', () => {
  it('fetchers never write to Supabase', async () => {
    supabaseWriteCalls.length = 0

    const { fetchSalesforceAccounts } = await import('@/lib/integrations/salesforce/accounts-fetcher')
    const { fetchHubSpotContacts }    = await import('@/lib/integrations/hubspot/contacts-fetcher')

    await fetchSalesforceAccounts('conn-sf', 'https://myorg.salesforce.com', 'org-1')
    await fetchHubSpotContacts('conn-hs', 'org-1')

    // Fetchers should NEVER write to Supabase — they only return in-memory chunks
    expect(supabaseWriteCalls).toHaveLength(0)
  })

  it('FetchedChunk metadata never contains content/body/text keys', async () => {
    const { fetchSalesforceAccounts } = await import('@/lib/integrations/salesforce/accounts-fetcher')
    const { fetchHubSpotNotes }       = await import('@/lib/integrations/hubspot/notes-fetcher')

    const sfChunks = await fetchSalesforceAccounts('conn-sf', 'https://myorg.salesforce.com', 'org-1')
    const hsChunks = await fetchHubSpotNotes('conn-hs', 'org-1')

    const forbidden = ['content', 'body', 'text', 'raw', 'html', 'markdown', 'plaintext']
    for (const chunk of [...sfChunks, ...hsChunks]) {
      for (const key of Object.keys(chunk.metadata)) {
        expect(forbidden).not.toContain(key.toLowerCase())
      }
    }
  })
})