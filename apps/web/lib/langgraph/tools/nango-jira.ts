// ============================================================
// nango-jira.ts — Bulk indexing pipeline for Jira (ATH-31)
//
// Fetches all issues from a Jira project via paginated JQL,
// converts them to FetchedChunk[], and passes to indexDocuments()
// for chunking, embedding, and vector upsert.
//
// Rule #2: content lives only in RAM — it is passed to
// indexDocuments() which embeds it, then discards it. No issue
// body is ever written to Supabase directly.
// ============================================================

import { getCloudId, atlassianFetch } from '@/lib/integrations/atlassian/client'
import { extractTextFromADF } from '@/lib/integrations/atlassian/adf-to-text'
import { indexDocuments } from '@/lib/integrations/indexing'
import type { FetchedChunk } from '@/lib/integrations/base'

// ---- Types --------------------------------------------------

interface JiraIssue {
  key: string
  fields: {
    summary: string
    description: unknown | null
    status?: { name: string }
    priority?: { name: string }
    assignee?: { displayName: string }
    issuetype?: { name: string }
    updated: string
    labels: string[]
  }
}

interface JiraSearchResult {
  issues: JiraIssue[]
  total: number
}

export interface IndexJiraResult {
  indexed: number
  failed: number
}

// ---- Bulk indexing ------------------------------------------

/**
 * Bulk indexing pipeline for a Jira project.
 * Fetches all issues via paginated JQL, converts to FetchedChunk[],
 * and sends to the shared indexing pipeline for embedding + vector upsert.
 *
 * Runs via QStash background worker — not called in the request path.
 *
 * @param connectionId - Nango connection ID
 * @param projectKey   - Jira project key (e.g. "ATHENE", "ENG")
 * @param orgId        - Clerk org ID for RLS context
 * @param deptId       - Department ID for access scoping
 */
export async function indexJiraProject(
  connectionId: string,
  projectKey: string,
  orgId: string,
  deptId: string | null
): Promise<IndexJiraResult> {
  const cloudId = await getCloudId(connectionId, orgId, 'jira')
  let startAt = 0
  const batchSize = 100
  let totalIndexed = 0
  let totalFailed = 0

  while (true) {
    const data = await atlassianFetch<JiraSearchResult>(
      connectionId,
      cloudId,
      `/rest/api/3/search?jql=project=${projectKey}&fields=summary,description,status,assignee,updated,labels,issuetype,priority&startAt=${startAt}&maxResults=${batchSize}`,
      orgId,
      'jira'
    )

    if (!data.issues || data.issues.length === 0) break

    // Build FetchedChunk[] for this batch — content stays in RAM
    const chunks: FetchedChunk[] = data.issues.map((issue): FetchedChunk => {
      const descriptionText = extractTextFromADF(issue.fields.description as any)

      const content = [
        `${issue.key}: ${issue.fields.summary}`,
        issue.fields.status?.name ? `Status: ${issue.fields.status.name}` : null,
        issue.fields.priority?.name ? `Priority: ${issue.fields.priority.name}` : null,
        issue.fields.assignee?.displayName
          ? `Assignee: ${issue.fields.assignee.displayName}`
          : null,
        issue.fields.issuetype?.name ? `Type: ${issue.fields.issuetype.name}` : null,
        issue.fields.labels.length > 0
          ? `Labels: ${issue.fields.labels.join(', ')}`
          : null,
        descriptionText ? `\n${descriptionText}` : null,
      ]
        .filter(Boolean)
        .join('\n')

      return {
        chunk_id: `jira-issue-${issue.key}`,
        title: `${issue.key}: ${issue.fields.summary}`,
        content,
        source_url: `https://athene-ai.atlassian.net/browse/${issue.key}`,
        metadata: {
          provider: 'jira',
          resource_type: 'issue',
          project_key: projectKey,
          issue_key: issue.key,
          status: issue.fields.status?.name ?? null,
          priority: issue.fields.priority?.name ?? null,
          assignee: issue.fields.assignee?.displayName ?? null,
          issue_type: issue.fields.issuetype?.name ?? null,
          labels: issue.fields.labels,
          last_modified: issue.fields.updated,
        },
      }
    })

    // Pass the batch to the shared indexing pipeline
    const { indexed, errors } = await indexDocuments(chunks, orgId, connectionId, deptId)
    totalIndexed += indexed
    totalFailed += errors

    if (data.issues.length < batchSize) break
    startAt += batchSize
  }

  return { indexed: totalIndexed, failed: totalFailed }
}

// ---- Live search (Mode B) -----------------------------------

/**
 * Real-time JQL search for LangGraph retrieval-agent use.
 * Returns raw Jira API response — not indexed, ephemeral.
 *
 * @param connectionId - Nango connection ID
 * @param jql          - JQL query string
 * @param orgId        - Clerk org ID
 */
export async function liveJiraSearch(
  connectionId: string,
  jql: string,
  orgId: string
): Promise<FetchedChunk[]> {
  const cloudId = await getCloudId(connectionId, orgId, 'jira')

  const data = await atlassianFetch<JiraSearchResult>(
    connectionId,
    cloudId,
    `/rest/api/3/search?jql=${encodeURIComponent(jql)}&maxResults=10&fields=summary,description,status,priority,assignee,updated`,
    orgId,
    'jira'
  )

  return (data.issues ?? []).map((issue): FetchedChunk => {
    const descriptionText = extractTextFromADF(issue.fields.description as any)

    return {
      chunk_id: `jira-issue-${issue.key}`,
      title: `${issue.key}: ${issue.fields.summary}`,
      content: [
        `${issue.key}: ${issue.fields.summary}`,
        issue.fields.status?.name ? `Status: ${issue.fields.status.name}` : null,
        issue.fields.priority?.name ? `Priority: ${issue.fields.priority.name}` : null,
        descriptionText ? `\n${descriptionText}` : null,
      ]
        .filter(Boolean)
        .join('\n'),
      source_url: `https://athene-ai.atlassian.net/browse/${issue.key}`,
      metadata: {
        provider: 'jira',
        resource_type: 'issue',
        issue_key: issue.key,
        status: issue.fields.status?.name ?? null,
        priority: issue.fields.priority?.name ?? null,
        last_modified: issue.fields.updated,
      },
    }
  })
}
