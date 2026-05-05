import { googleFetch } from './api-client'
import type { FetchedChunk } from '@/lib/integrations/base'
import { assertSafeMetadata } from '@/lib/integrations/base'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface GmailMessageRef {
  id: string
  threadId: string
}

export interface GmailHeader {
  name: string
  value: string
}

export interface GmailMessageMetadata {
  id: string
  threadId: string
  labelIds: string[]
  snippet: string
  headers: {
    from?: string
    subject?: string
    date?: string
    to?: string
  }
  internalDate: string
}

export interface GmailMessageFull {
  id: string
  threadId: string
  labelIds: string[]
  snippet: string
  payload: GmailPayloadPart
}

export interface GmailPayloadPart {
  mimeType: string
  headers?: GmailHeader[]
  body?: { size: number; data?: string }
  parts?: GmailPayloadPart[]
}

// ─── Email Listing (Metadata Only) ──────────────────────────────────────────

/**
 * Lists unread emails from the user's Gmail inbox.
 * ⚠️ CRITICAL: Returns METADATA ONLY — bodies are NEVER indexed or cached.
 */
export async function listUnreadEmails(
  connectionId: string,
  orgId: string,
  limit: number = 20
): Promise<GmailMessageMetadata[]> {
  const listUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=is:unread&maxResults=${limit}`
  const list = await googleFetch<{ messages?: GmailMessageRef[] }>(connectionId, orgId, listUrl)

  if (!list.messages || list.messages.length === 0) return []

  const metadataPromises = list.messages.map(async (msg) => {
    const metaUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date&metadataHeaders=To`
    const full = await googleFetch<{
      id: string
      threadId: string
      labelIds: string[]
      snippet: string
      payload: { headers: GmailHeader[] }
      internalDate: string
    }>(connectionId, orgId, metaUrl)

    return {
      id: full.id,
      threadId: full.threadId,
      labelIds: full.labelIds,
      snippet: full.snippet,
      headers: extractHeaders(full.payload.headers),
      internalDate: full.internalDate,
    }
  })

  return Promise.all(metadataPromises)
}

/**
 * Searches Gmail messages using Google's search query syntax.
 */
export async function searchEmails(
  connectionId: string,
  orgId: string,
  query: string,
  limit: number = 10
): Promise<GmailMessageMetadata[]> {
  const encodedQuery = encodeURIComponent(query)
  const listUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodedQuery}&maxResults=${limit}`
  const list = await googleFetch<{ messages?: GmailMessageRef[] }>(connectionId, orgId, listUrl)

  if (!list.messages || list.messages.length === 0) return []

  const metadataPromises = list.messages.map(async (msg) => {
    const metaUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date&metadataHeaders=To`
    const full = await googleFetch<{
      id: string
      threadId: string
      labelIds: string[]
      snippet: string
      payload: { headers: GmailHeader[] }
      internalDate: string
    }>(connectionId, orgId, metaUrl)

    return {
      id: full.id,
      threadId: full.threadId,
      labelIds: full.labelIds,
      snippet: full.snippet,
      headers: extractHeaders(full.payload.headers),
      internalDate: full.internalDate,
    }
  })

  return Promise.all(metadataPromises)
}

// ─── Live Body Fetching ──────────────────────────────────────────────────────

/**
 * Fetches the full body of a specific email.
 * ⚠️ NEVER CACHE THIS — live fetch only, per architectural requirement.
 */
export async function fetchEmailBody(
  connectionId: string,
  orgId: string,
  messageId: string
): Promise<string> {
  const url = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=full`
  const msg = await googleFetch<GmailMessageFull>(connectionId, orgId, url)
  return extractBodyFromPayload(msg.payload)
}

// ─── Sending ─────────────────────────────────────────────────────────────────

/**
 * Sends an email through the authenticated user's Gmail account.
 */
export async function sendEmail(
  connectionId: string,
  orgId: string,
  raw: string
): Promise<{ id: string; threadId: string }> {
  const url = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send'
  return googleFetch<{ id: string; threadId: string }>(connectionId, orgId, url, {
    method: 'POST',
    body: { raw },
  })
}

// ─── FetchedChunk Builders ──────────────────────────────────────────────────

/**
 * Converts a GmailMessageMetadata into a FetchedChunk for the agent's
 * response formatter. Uses snippet + headers only — bodies are NEVER indexed.
 *
 * @param msg - The email metadata from listUnreadEmails or searchEmails.
 * @returns A metadata-only FetchedChunk for display in agent responses.
 */
export function gmailMetadataToChunk(msg: GmailMessageMetadata): FetchedChunk {
  const metadata: FetchedChunk['metadata'] = {
    provider: 'google',
    resource_type: 'email',
    last_modified: new Date(Number(msg.internalDate)).toISOString(),
    author: msg.headers.from,
    thread_id: msg.threadId,
    labels: msg.labelIds.join(','),
  }
  assertSafeMetadata(metadata)

  const subject = msg.headers.subject || '(no subject)'

  return {
    chunk_id: `gmail:${msg.id}`,
    title: subject,
    content: msg.snippet,
    source_url: `https://mail.google.com/mail/u/0/#inbox/${msg.id}`,
    metadata,
  }
}

/**
 * Convenience wrapper: runs searchEmails and returns FetchedChunk[].
 * This is what the agent calls for live Gmail search.
 */
export async function searchEmailChunks(
  connectionId: string,
  orgId: string,
  query: string,
  limit: number = 10,
): Promise<FetchedChunk[]> {
  const results = await searchEmails(connectionId, orgId, query, limit)
  return results.map(gmailMetadataToChunk)
}

// ─── Internal Helpers ────────────────────────────────────────────────────────

function extractHeaders(headers: GmailHeader[]): GmailMessageMetadata['headers'] {
  const result: GmailMessageMetadata['headers'] = {}
  for (const h of headers) {
    const key = h.name.toLowerCase()
    if (key === 'from') result.from = h.value
    if (key === 'subject') result.subject = h.value
    if (key === 'date') result.date = h.value
    if (key === 'to') result.to = h.value
  }
  return result
}

function extractBodyFromPayload(payload: GmailPayloadPart): string {
  if (payload.body?.data && payload.mimeType === 'text/plain') {
    return decodeBase64Url(payload.body.data)
  }

  if (payload.parts) {
    for (const part of payload.parts) {
      if (part.mimeType === 'text/plain' && part.body?.data) {
        return decodeBase64Url(part.body.data)
      }
    }

    for (const part of payload.parts) {
      if (part.mimeType === 'text/html' && part.body?.data) {
        const html = decodeBase64Url(part.body.data)
        return stripHtmlTags(html)
      }
    }

    for (const part of payload.parts) {
      if (part.parts) {
        const nested = extractBodyFromPayload(part)
        if (nested) return nested
      }
    }
  }

  if (payload.body?.data) {
    return decodeBase64Url(payload.body.data)
  }

  return '[No readable body content found]'
}

function decodeBase64Url(data: string): string {
  const base64 = data.replace(/-/g, '+').replace(/_/g, '/')
  return Buffer.from(base64, 'base64').toString('utf-8')
}

function stripHtmlTags(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .trim()
}
