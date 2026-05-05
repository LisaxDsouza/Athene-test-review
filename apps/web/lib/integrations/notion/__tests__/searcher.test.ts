import { describe, it, expect, vi, beforeEach } from 'vitest'
import { notionSearch } from '../searcher'
import * as client from '../client'

vi.mock('../client', () => ({
  notionFetch: vi.fn(),
}))

describe('notion searcher', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should call notion search endpoint and format results', async () => {
    vi.mocked(client.notionFetch).mockResolvedValue({
      results: [{
        object: 'page',
        id: 'p1',
        url: 'https://notion.so/p1',
        properties: {
          title: { title: [{ plain_text: 'Search Result' }] }
        }
      }]
    })

    const results = await notionSearch('conn-1', 'org-1', 'query')

    expect(results).toHaveLength(1)
    expect(results[0].title).toBe('Search Result')
    expect(client.notionFetch).toHaveBeenCalledWith('conn-1', 'org-1', '/search', expect.objectContaining({
      query: 'query'
    }))
  })
})
