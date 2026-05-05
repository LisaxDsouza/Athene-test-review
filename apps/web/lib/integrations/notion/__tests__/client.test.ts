import { describe, it, expect, vi, beforeEach } from 'vitest'
import { notionFetch } from '../client'

vi.mock('@/lib/integrations/base', async () => {
  const actual = await vi.importActual('@/lib/integrations/base')
  return {
    ...actual,
    getProviderToken: vi.fn().mockResolvedValue('test-token'),
  }
})

describe('notion client', () => {
  const mockFetch = vi.fn()
  global.fetch = mockFetch

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should include correct headers', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ results: [] })
    })

    await notionFetch('conn-123', 'org-123', '/pages')

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('api.notion.com/v1/pages'),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer test-token',
          'Notion-Version': '2022-06-28',
        })
      })
    )
  })

  it('should retry on 429', async () => {
    mockFetch.mockResolvedValueOnce({
      status: 429,
      headers: new Map([['Retry-After', '0']])
    })
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true })
    })

    vi.spyOn(global, 'setTimeout').mockImplementation((fn: any) => fn())

    const result = await notionFetch('conn-123', 'org-123', '/pages')

    expect(mockFetch).toHaveBeenCalledTimes(2)
    expect(result.success).toBe(true)
  })

  it('should throw error on non-ok response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      json: async () => ({ error: 'Not found' })
    })

    await expect(notionFetch('conn-123', 'org-123', '/invalid')).rejects.toThrow('Notion API Error: 404')
  })
})
