// ============================================================
// api/worker/nango-fetch/route.ts — Background fetch worker
//
// Called by QStash after dispatchThrottled() publishes a job.
// Flow:
//   1. Verify QStash signature (security)
//   2. Extract { orgId, connectionId, provider } from body
//   3. Look up the correct fetcher from providerFetcherMap
//   4. Call fetcher → get FetchedChunk[]
//   5. Pass each chunk through indexDocument()
//   6. Call releaseSlot() to free QStash concurrency
//
// Security rules:
//   • QStash signature verification required
//   • Nango token obtained inside fetcher, used once, discarded
//   • No tokens or raw content logged
// ============================================================

import { NextResponse } from 'next/server'
import { verifyQStashSignature } from '@/lib/qstash/verify'
import { releaseSlot, qstash } from '@/lib/qstash/client'
import { indexDocuments } from '@/lib/integrations/indexing'
import { logger } from '@/lib/logger'
import { fetchSlackMessages } from '@/lib/integrations/slack/channels-fetcher'
import { fetchZendeskTickets } from '@/lib/integrations/zendesk/tickets-fetcher'
import { fetchZendeskArticles } from '@/lib/integrations/zendesk/articles-fetcher'
import { fetchCalendarChunks } from '@/lib/integrations/google/calendar-fetcher'
import { fetchDriveChunks } from '@/lib/integrations/google/drive-fetcher'
import { searchEmailChunks } from '@/lib/integrations/google/gmail-fetcher'
import { fetchHubSpotCompanies } from '@/lib/integrations/hubspot/companies-fetcher'
import { fetchHubSpotContacts } from '@/lib/integrations/hubspot/contacts-fetcher'
import { fetchHubSpotDeals } from '@/lib/integrations/hubspot/deals-fetcher'
import { fetchHubSpotNotes } from '@/lib/integrations/hubspot/notes-fetcher'
import { fetchAllDatabases } from '@/lib/integrations/notion/databases-fetcher'
import { fetchAllPages } from '@/lib/integrations/notion/pages-fetcher'
import { fetchSalesforceAccounts } from '@/lib/integrations/salesforce/accounts-fetcher'
import { fetchSalesforceCases } from '@/lib/integrations/salesforce/cases-fetcher'
import { fetchSalesforceOpportunities } from '@/lib/integrations/salesforce/opportunities-fetcher'
import { fetchSnowflakeSamples } from '@/lib/integrations/snowflake/sample-fetcher'
import { githubIssuesFetcher } from '@/lib/integrations/github/issues-fetcher'
import { githubPrsFetcher } from '@/lib/integrations/github/prs-fetcher'
import { githubWikiFetcher } from '@/lib/integrations/github/wiki-fetcher'
import { linearIssuesFetcher } from '@/lib/integrations/linear/issues-fetcher'
import { linearCyclesFetcher } from '@/lib/integrations/linear/cycles-fetcher'
import { linearProjectsFetcher } from '@/lib/integrations/linear/projects-fetcher'
import { getProviderMetadata } from '@/lib/integrations/base'
import type { FetchedChunk } from '@/lib/integrations/base'
import { microsoftFetcher } from '@/lib/integrations/microsoft/index'
import { fetchJiraIssues } from '@/lib/integrations/atlassian/jira-fetcher'
import { fetchConfluencePages } from '@/lib/integrations/atlassian/confluence-fetcher'
import { getAppBaseUrl } from '@/lib/config/app-url'
import { retryWithBackoff } from '@/lib/integrations/retry'
import { supabaseAdmin } from '@/lib/supabase/server'

export const maxDuration = 300; // Vercel max for Pro plan

// ---- Provider Fetcher Map ---------------------------------------

type FetcherFn = (
  connectionId: string,
  orgId: string,
  options?: { since?: string; limit?: number }
) => Promise<FetchedChunk[]>

/**
 * Map of provider names to their full-sync fetcher functions.
 * Each fetcher returns FetchedChunk[] for indexing.
 */
const providerFetcherMap: Record<string, FetcherFn[]> = {
  slack: [
    async (connectionId, orgId) => fetchSlackMessages(connectionId, orgId),
  ],

  'google-drive': [
    async (connectionId, orgId) => fetchDriveChunks(connectionId, orgId),
  ],

  gmail: [
    // Full-sync: fetch recent emails (broad query, last 90 days)
    async (connectionId, orgId) => searchEmailChunks(connectionId, orgId, 'newer_than:90d', 50),
  ],

  'google-calendar': [
    // Full-sync: fetch events from 30 days ago to 90 days ahead
    async (connectionId, orgId) => {
      const timeMin = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
      const timeMax = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000)
      return fetchCalendarChunks(connectionId, orgId, timeMin, timeMax)
    },
  ],

  hubspot: [
    async (connectionId, orgId) => {
      const [companies, contacts, deals, notes] = await Promise.all([
        fetchHubSpotCompanies(connectionId, orgId),
        fetchHubSpotContacts(connectionId, orgId),
        fetchHubSpotDeals(connectionId, orgId),
        fetchHubSpotNotes(connectionId, orgId),
      ])
      return [...companies, ...contacts, ...deals, ...notes]
    },
  ],

  notion: [
    async (connectionId, orgId) => {
      const [pages, databases] = await Promise.all([
        fetchAllPages(connectionId, orgId),
        fetchAllDatabases(connectionId, orgId),
      ])
      return [...pages, ...databases]
    },
  ],

  salesforce: [
    async (connectionId, orgId) => {
      const metadata = await getProviderMetadata(connectionId, 'salesforce', orgId)
      const instanceUrl = metadata.instance_url as string | undefined
      if (!instanceUrl) {
        throw new Error(`Salesforce instance_url not found for connection ${connectionId}`)
      }
      const [accounts, cases, opportunities] = await Promise.all([
        fetchSalesforceAccounts(connectionId, instanceUrl, orgId),
        fetchSalesforceCases(connectionId, instanceUrl, orgId),
        fetchSalesforceOpportunities(connectionId, instanceUrl, orgId),
      ])
      return [...accounts, ...cases, ...opportunities]
    },
  ],

  snowflake: [
    async (connectionId, orgId) => fetchSnowflakeSamples(connectionId, orgId),
  ],

  github: [
    async (connectionId, orgId) => {
      const metadata = await getProviderMetadata(connectionId, 'github', orgId)
      const owner = metadata.owner as string | undefined
      const repo = metadata.repo as string | undefined
      if (!owner || !repo) {
        throw new Error(`GitHub owner/repo not found for connection ${connectionId}`)
      }
      const [issues, prs, wiki] = await Promise.all([
        githubIssuesFetcher(connectionId, orgId, owner, repo),
        githubPrsFetcher(connectionId, orgId, owner, repo),
        githubWikiFetcher(connectionId, orgId, owner, repo),
      ])
      return [...issues, ...prs, ...wiki]
    },
  ],

  linear: [
    async (connectionId, orgId) => {
      const [issues, cycles, projects] = await Promise.all([
        linearIssuesFetcher(connectionId, orgId),
        linearCyclesFetcher(connectionId, orgId),
        linearProjectsFetcher(connectionId, orgId),
      ])
      return [...issues, ...cycles, ...projects]
    },
  ],

  zendesk: [
    async (connectionId, orgId) => {
      const metadata = await getProviderMetadata(connectionId, 'zendesk', orgId)
      const subdomain = metadata.subdomain

      if (!subdomain) {
        throw new Error(`Zendesk subdomain not found for connection ${connectionId}`)
      }

      const [tickets, articles] = await Promise.all([
        fetchZendeskTickets(connectionId, orgId, subdomain),
        fetchZendeskArticles(connectionId, orgId, subdomain),
      ])
      return [...tickets, ...articles]
    },
  ],

  'microsoft-graph': [microsoftFetcher],

  // Aliases for UI nangoKey values that fan out to per-service fetchers
  google: [
    async (connectionId, orgId) => fetchDriveChunks(connectionId, orgId),
    async (connectionId, orgId) => searchEmailChunks(connectionId, orgId, 'newer_than:90d', 50),
    async (connectionId, orgId) => {
      const timeMin = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
      const timeMax = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000)
      return fetchCalendarChunks(connectionId, orgId, timeMin, timeMax)
    },
  ],
  microsoft: [microsoftFetcher],

  jira: [fetchJiraIssues],

  confluence: [fetchConfluencePages],
}

// ---- Request body type ------------------------------------------

interface NangoFetchJobBody {
  orgId: string
  connectionId: string
  provider: string           // 'slack' | 'zendesk' | 'google' | 'hubspot' | 'notion' | 'salesforce' | 'snowflake' | 'github' | 'linear'
  sourceType: string         // same as provider, used for QStash concurrency key
  departmentId?: string | null
  since?: string             // ISO-8601, for incremental sync
}

// ---- POST handler -----------------------------------------------

export async function POST(request: Request): Promise<Response> {
  // 1. Verify QStash signature
  const isValid = await verifyQStashSignature(request)
  if (!isValid) {
    return new Response('Invalid QStash signature', { status: 401 })
  }

  let body: NangoFetchJobBody

  try {
    body = (await request.json()) as NangoFetchJobBody
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { orgId, connectionId, provider, sourceType, departmentId, since } = body

  // 2. Validate required fields
  if (!orgId || !connectionId || !provider) {
    return NextResponse.json(
      { error: 'Missing required fields: orgId, connectionId, provider' },
      { status: 400 }
    )
  }

  // 2a. Verify connection belongs to this org (defense-in-depth)
  const { data: conn } = await supabaseAdmin
    .from('nango_connections')
    .select('id, org_id')
    .eq('connection_id', connectionId)
    .eq('org_id', orgId)
    .maybeSingle()

  if (!conn) {
    logger.warn({ connectionId, orgId }, '[nango-fetch] Connection not found for org, skipping')
    return NextResponse.json({ error: 'Connection not found' }, { status: 404 })
  }

  // 3. Look up the fetcher
  const fetchers = providerFetcherMap[provider]
  if (!fetchers) {
    return NextResponse.json(
      { error: `Unknown provider: ${provider}. Available: ${Object.keys(providerFetcherMap).join(', ')}` },
      { status: 400 }
    )
  }

  try {
    // 4. Run all fetchers for this provider, each wrapped with retry+backoff.
    // If a fetcher still fails after retries, log and continue — partial sync
    // is better than no sync.
    const allChunks: FetchedChunk[] = []
    for (const fetcher of fetchers) {
      try {
        const chunks = await retryWithBackoff(
          () => fetcher(connectionId, orgId, { since }),
          {
            retries: 3,
            baseDelayMs: 1000,
            onRetry: (err, attempt) => {
              logger.warn(
                { provider, orgId, attempt, err: err instanceof Error ? err.message : String(err) },
                '[nango-fetch] Fetcher failed, retrying'
              )
            },
          }
        )
        allChunks.push(...chunks)
      } catch (fetcherErr) {
        logger.error(
          { provider, orgId, err: fetcherErr instanceof Error ? fetcherErr.message : String(fetcherErr) },
          '[nango-fetch] Fetcher failed after all retries, continuing with partial results'
        )
      }
    }

    // 5. Index all fetched chunks (connectionId resolves/creates the documents row)
    const result = await indexDocuments(
      allChunks,
      orgId,
      connectionId,
      departmentId ?? null
    )

    // 6. Enqueue graph-build job if any chunks were indexed (ATH-44)
    //    Fire-and-forget: graph build runs asynchronously after embedding.
    if (result.indexed > 0) {
      const docIds = result.documentIds
      const graphBuildUrl = `${getAppBaseUrl()}/api/worker/graph-build`
      try {
        await qstash.publishJSON({
          url: graphBuildUrl,
          body: {
            org_id: orgId,
            document_ids: docIds,
            job_type: 'incremental',
          },
        })
        console.log(
          `[nango-fetch] Enqueued graph-build for org=${orgId}, docs=${docIds.length}`,
        )
      } catch (gErr) {
        // Non-fatal: graph build will be triggered on next sync if this fails
        console.error('[nango-fetch] Failed to enqueue graph-build:', gErr)
      }
    }

    // 7. Release QStash concurrency slot
    await releaseSlot(orgId, sourceType || provider)

    return NextResponse.json({
      status: 'ok',
      provider,
      chunks_fetched: allChunks.length,
      chunks_indexed: result.indexed,
      errors: result.errors,
    })
  } catch (err) {
    logger.error(
      { provider, orgId, err: err instanceof Error ? err.message : String(err) },
      '[nango-fetch] Worker error'
    )

    // Still release the slot even on error to prevent deadlock
    try {
      await releaseSlot(orgId, sourceType || provider)
    } catch {
      // Best-effort release
    }

    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 }
    )
  }
}
