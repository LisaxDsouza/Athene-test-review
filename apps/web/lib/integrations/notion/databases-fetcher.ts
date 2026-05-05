import { notionFetch } from './client'
import { FetchedChunk } from '../base'

export async function fetchAllDatabases(connectionId: string, orgId: string): Promise<FetchedChunk[]> {
  const chunks: FetchedChunk[] = []
  let hasMore = true
  let startCursor: string | undefined = undefined

  while (hasMore) {
    // 1. Search for all databases
    const searchResults = await notionFetch(connectionId, orgId, '/search', {
      filter: {
        property: 'object',
        value: 'database'
      },
      start_cursor: startCursor
    })

    for (const db of searchResults.results) {
      if (db.object !== 'database') continue

      const title = getDatabaseTitle(db)
      const content = await fetchDatabaseContent(connectionId, orgId, db.id)

      chunks.push({
        chunk_id: `notion_db_${db.id}`,
        title: `Database: ${title}`,
        content,
        source_url: db.url,
        metadata: {
          provider: 'notion',
          resource_type: 'database',
          last_modified: db.last_edited_time
        }
      })
    }

    hasMore = searchResults.has_more
    startCursor = searchResults.next_cursor
  }

  return chunks
}

async function fetchDatabaseContent(connectionId: string, orgId: string, databaseId: string): Promise<string> {
  let content = ''
  let hasMore = true
  let startCursor: string | undefined = undefined

  while (hasMore) {
    const response = await notionFetch(connectionId, orgId, `/databases/${databaseId}/query`, {
      start_cursor: startCursor
    })

    for (const page of response.results) {
      content += pageToRowSummary(page) + '\n'
    }

    hasMore = response.has_more
    startCursor = response.next_cursor
  }

  return content
}

function pageToRowSummary(page: any): string {
  const properties = page.properties
  const summary: string[] = []

  for (const [name, prop] of Object.entries(properties)) {
    const value = getPropertyValue(prop)
    if (value) {
      summary.push(`${name}: ${value}`)
    }
  }

  return summary.join(' | ')
}

function getPropertyValue(prop: any): string {
  const type = prop.type
  const data = prop[type]

  switch (type) {
    case 'title':
    case 'rich_text':
      return data.map((t: any) => t.plain_text).join('')
    case 'number':
      return data?.toString() || ''
    case 'select':
      return data?.name || ''
    case 'multi_select':
      return data.map((s: any) => s.name).join(', ')
    case 'date':
      return data ? `${data.start}${data.end ? ` to ${data.end}` : ''}` : ''
    case 'checkbox':
      return data ? 'Yes' : 'No'
    case 'url':
      return data || ''
    case 'email':
      return data || ''
    case 'phone_number':
      return data || ''
    case 'people':
      return data.map((p: any) => p.name || p.id).join(', ')
    default:
      return ''
  }
}

function getDatabaseTitle(db: any): string {
  if (db.title && db.title.length > 0) {
    return db.title.map((t: any) => t.plain_text).join('')
  }
  return 'Untitled Database'
}
