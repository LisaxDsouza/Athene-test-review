import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fetchAllDatabases } from '../databases-fetcher'
import * as client from '../client'

vi.mock('../client', () => ({
  notionFetch: vi.fn(),
}))

describe('notion databases-fetcher', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should fetch databases and pages within them', async () => {
    vi.mocked(client.notionFetch).mockImplementation(async (connectionId, orgId, path) => {
      if (path === '/search') {
        return {
          results: [{
            object: 'database',
            id: 'db1',
            url: 'https://notion.so/db1',
            title: [{ plain_text: 'Test DB' }]
          }],
          has_more: false
        }
      }
      if (path === '/databases/db1/query') {
        return {
          results: [{
            object: 'page',
            properties: {
              Name: { type: 'title', title: [{ plain_text: 'Item 1' }] },
              Status: { type: 'select', select: { name: 'Done' } }
            }
          }],
          has_more: false
        }
      }
      return { results: [] }
    })

    const chunks = await fetchAllDatabases('conn-123', 'org-123')
    
    expect(chunks).toHaveLength(1)
    expect(chunks[0].title).toBe('Database: Test DB')
    expect(chunks[0].content).toContain('Name: Item 1')
    expect(chunks[0].content).toContain('Status: Done')
  })
})
