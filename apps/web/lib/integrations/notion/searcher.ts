import { notionFetch } from './client'
import { FetchedChunk } from '../base'

export async function notionSearch(connectionId: string, orgId: string, query: string): Promise<FetchedChunk[]> {
  const searchResults = await notionFetch(connectionId, orgId, '/search', {
    query,
    filter: {
      property: 'object',
      value: 'page' // Search pages primarily
    },
    page_size: 10
  })

  const chunks: FetchedChunk[] = []
  
  for (const page of searchResults.results) {
    if (page.object !== 'page') continue
    
    chunks.push({
      chunk_id: `notion_search_${page.id}`,
      title: getPageTitle(page),
      content: `Search result content - Page ID: ${page.id}. URL: ${page.url}`, 
      source_url: page.url,
      metadata: {
        provider: 'notion',
        resource_type: 'page',
        last_modified: page.last_edited_time
      }
    })
  }

  return chunks
}

function getPageTitle(page: any): string {
  const titleProp = page.properties.title || page.properties.Name || Object.values(page.properties).find((p: any) => p.type === 'title')
  if (titleProp && titleProp.title && titleProp.title.length > 0) {
    return titleProp.title.map((t: any) => t.plain_text).join('')
  }
  return 'Untitled'
}
