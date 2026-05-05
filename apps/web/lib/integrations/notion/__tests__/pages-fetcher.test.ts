import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fetchAllPages } from '../pages-fetcher'
import * as client from '../client'

vi.mock('../client', () => ({
  notionFetch: vi.fn(),
}))

describe('notion pages-fetcher', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should fetch all pages and recurse into blocks', async () => {
    // Mock search results
    vi.mocked(client.notionFetch).mockImplementation(async (connectionId, path) => {
      if (path === '/search') {
        return {
          results: [{
            object: 'page',
            id: 'p1',
            url: 'https://notion.so/p1',
            properties: {
              title: { title: [{ plain_text: 'Test Page' }] }
            }
          }],
          has_more: false,
          next_cursor: null
        }
      }
      if (path === '/blocks/p1/children') {
        return {
          results: [
            { type: 'paragraph', paragraph: { rich_text: [{ plain_text: 'Hello World' }] }, has_children: false }
          ],
          has_more: false
        }
      }
      return { results: [], has_more: false }
    })

    const chunks = await fetchAllPages('conn-123', 'org-123')

    expect(chunks).toHaveLength(1)
    expect(chunks[0].title).toBe('Test Page')
    expect(chunks[0].content).toContain('Hello World')
    expect(client.notionFetch).toHaveBeenCalledWith('conn-123', 'org-123', '/search', expect.any(Object))
  })
})
