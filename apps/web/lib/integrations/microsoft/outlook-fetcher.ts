import { graphFetch } from './graph-client'

export interface EmailDraft {
  subject: string
  body: {
    contentType: 'Text' | 'HTML'
    content: string
  }
  toRecipients: {
    emailAddress: {
      address: string
    }
  }[]
  ccRecipients?: {
    emailAddress: {
      address: string
    }
  }[]
  bccRecipients?: {
    emailAddress: {
      address: string
    }
  }[]
}

/**
 * Fetches unread emails for the morning briefing.
 * CRITICAL: Email bodies are NEVER indexed. Only fetched live and discarded.
 * We only fetch the bodyPreview for the briefing.
 */
export async function fetchUnreadEmails(connectionId: string, orgId: string, limit = 20) {
  const data = await graphFetch(connectionId, orgId, `/me/messages?$filter=isRead eq false&$top=${limit}&$select=subject,from,receivedDateTime,bodyPreview`)
  return data.value
}

/**
 * Fetches the full body of a specific email.
 * Implementation note: caller must discard after use.
 */
export async function fetchEmailBody(connectionId: string, orgId: string, messageId: string): Promise<string> {
  const data = await graphFetch(connectionId, orgId, `/me/messages/${messageId}?$select=body`)
  return data.body.content
}

/**
 * Sends an email on behalf of the user.
 * Requires approval upstream.
 */
export async function sendEmail(connectionId: string, orgId: string, message: EmailDraft) {
  await graphFetch(connectionId, orgId, `/me/sendMail`, {
    method: 'POST',
    body: JSON.stringify({ message, saveToSentItems: true }),
  })
}

/** @deprecated alias for backward compatibility */
export const readUnreadOutlookMessages = fetchUnreadEmails;
