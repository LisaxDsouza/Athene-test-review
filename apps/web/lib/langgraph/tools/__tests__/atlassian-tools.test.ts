import { vi, describe, it, expect, beforeEach } from 'vitest'
import { indexJiraProject, liveJiraSearch } from '../nango-jira'
import { indexConfluenceSpace } from '../nango-confluence'
import * as client from '@/lib/integrations/atlassian/client'

// Mock the Atlassian client
vi.mock('@/lib/integrations/atlassian/client', () => ({
  getCloudId: vi.fn(),
  atlassianFetch: vi.fn(),
}))

// Mock the shared indexing pipeline
vi.mock('@/lib/integrations/indexing', () => ({
  indexDocuments: vi.fn().mockResolvedValue({ indexed: 1, errors: 0 }),
}))

import { indexDocuments } from '@/lib/integrations/indexing'

describe('Atlassian LangGraph Tools', () => {
  const mockOrgId = 'org-123'
  const mockDeptId = 'dept-456'
  const mockConnId = 'conn-789'
  const mockCloudId = 'cloud-abc'

  const mockIssue = {
    key: 'PROJ-1',
    fields: {
      summary: 'Test Issue',
      description: { type: 'doc', content: [] },
      status: { name: 'To Do' },
      priority: { name: 'High' },
      assignee: { displayName: 'Alice' },
      issuetype: { name: 'Bug' },
      updated: '2026-04-22T00:00:00Z',
      labels: ['bug'],
    },
  }

  beforeEach(() => {
    vi.clearAllMocks()
    ;(client.getCloudId as any).mockResolvedValue(mockCloudId)
    ;(indexDocuments as any).mockResolvedValue({ indexed: 1, errors: 0 })
  })

  describe('Jira Tool', () => {
    it('indexJiraProject fetches issues with correct JQL and fields', async () => {
      ;(client.atlassianFetch as any).mockResolvedValueOnce({
        issues: [mockIssue],
        total: 1,
      })

      const result = await indexJiraProject(mockConnId, 'PROJ', mockOrgId, mockDeptId)

      expect(client.getCloudId).toHaveBeenCalledWith(mockConnId, mockOrgId, 'jira')
      expect(client.atlassianFetch).toHaveBeenCalledWith(
        mockConnId,
        mockCloudId,
        expect.stringContaining('project=PROJ'),
        mockOrgId,
        'jira'
      )

      // Verify metadata fields were requested
      const url = (client.atlassianFetch as any).mock.calls[0][2]
      expect(url).toContain('fields=summary,description,status,assignee,updated,labels,issuetype,priority')
      expect(result).toEqual({ indexed: 1, failed: 0 })
    })

    it('indexJiraProject passes correct FetchedChunk shape to indexDocuments', async () => {
      ;(client.atlassianFetch as any).mockResolvedValueOnce({
        issues: [mockIssue],
        total: 1,
      })

      await indexJiraProject(mockConnId, 'PROJ', mockOrgId, mockDeptId)

      expect(indexDocuments).toHaveBeenCalledOnce()
      const [chunks, orgId, deptId] = (indexDocuments as any).mock.calls[0]

      expect(orgId).toBe(mockOrgId)
      expect(deptId).toBe(mockDeptId)
      expect(chunks).toHaveLength(1)

      const chunk = chunks[0]
      expect(chunk.chunk_id).toBe('jira-issue-PROJ-1')
      expect(chunk.title).toBe('PROJ-1: Test Issue')
      expect(chunk.source_url).toContain('PROJ-1')
      expect(chunk.content).toContain('Test Issue')
      expect(chunk.metadata.provider).toBe('jira')
      expect(chunk.metadata.resource_type).toBe('issue')
      expect(chunk.metadata.project_key).toBe('PROJ')
      // Ensure no content-bearing keys leaked into metadata
      expect(chunk.metadata).not.toHaveProperty('content')
      expect(chunk.metadata).not.toHaveProperty('body')
    })

    it('indexJiraProject handles pagination correctly', async () => {
      const paginatedIssue = {
        key: 'P-1',
        fields: {
          summary: 'Paginated Issue',
          description: null,
          status: { name: 'Done' },
          priority: { name: 'Low' },
          assignee: null,
          issuetype: { name: 'Task' },
          updated: '2026-04-22T00:00:00Z',
          labels: [],
        },
      }

      ;(client.atlassianFetch as any)
        .mockResolvedValueOnce({ issues: Array(100).fill(paginatedIssue), total: 250 })
        .mockResolvedValueOnce({ issues: Array(100).fill(paginatedIssue), total: 250 })
        .mockResolvedValueOnce({ issues: [], total: 250 })

      const result = await indexJiraProject(mockConnId, 'PROJ', mockOrgId, mockDeptId)

      expect(client.atlassianFetch).toHaveBeenCalledTimes(3)
      expect(client.atlassianFetch).toHaveBeenNthCalledWith(
        2,
        expect.any(String),
        expect.any(String),
        expect.stringContaining('startAt=100'),
        expect.any(String),
        'jira'
      )
      expect(indexDocuments).toHaveBeenCalledTimes(2)
      expect(result.indexed).toBe(2) // 1 per indexDocuments call (mocked)
    })

    it('liveJiraSearch returns FetchedChunk[] for Mode B', async () => {
      ;(client.atlassianFetch as any).mockResolvedValueOnce({
        issues: [mockIssue],
        total: 1,
      })

      const results = await liveJiraSearch(mockConnId, 'key = PROJ-1', mockOrgId)

      expect(Array.isArray(results)).toBe(true)
      expect(results).toHaveLength(1)
      expect(results[0].chunk_id).toBe('jira-issue-PROJ-1')
      expect(results[0].title).toBe('PROJ-1: Test Issue')
      expect(results[0].source_url).toContain('PROJ-1')
      // liveJiraSearch must NOT call indexDocuments — results are ephemeral
      expect(indexDocuments).not.toHaveBeenCalled()
    })
  })

  describe('Confluence Tool', () => {
    const mockPage = {
      id: 'page-1',
      title: 'Test Page',
      body: { storage: { value: '<h1>Hello</h1><p>Some content here.</p>' } },
      version: { when: '2026-04-22T00:00:00Z', by: { displayName: 'Alice' } },
      metadata: { labels: { results: [{ name: 'internal' }] } },
      _links: { webui: '/pages/viewpage.action?pageId=1' },
    }

    it('indexConfluenceSpace fetches pages with labels expanded', async () => {
      ;(client.atlassianFetch as any).mockResolvedValueOnce({
        results: [mockPage],
        _links: {},
      })

      const result = await indexConfluenceSpace(mockConnId, 'SPACE', mockOrgId, mockDeptId)

      expect(client.getCloudId).toHaveBeenCalledWith(mockConnId, mockOrgId, 'confluence')
      expect(client.atlassianFetch).toHaveBeenCalledWith(
        mockConnId,
        mockCloudId,
        expect.stringContaining('spaceKey=SPACE'),
        mockOrgId,
        'confluence'
      )

      const url = (client.atlassianFetch as any).mock.calls[0][2]
      expect(url).toContain('expand=body.storage,version,metadata.labels')
      expect(result).toEqual({ indexed: 1, failed: 0 })
    })

    it('indexConfluenceSpace passes correct FetchedChunk shape to indexDocuments', async () => {
      ;(client.atlassianFetch as any).mockResolvedValueOnce({
        results: [mockPage],
        _links: {},
      })

      await indexConfluenceSpace(mockConnId, 'SPACE', mockOrgId, mockDeptId)

      expect(indexDocuments).toHaveBeenCalledOnce()
      const [chunks, orgId, deptId] = (indexDocuments as any).mock.calls[0]

      expect(orgId).toBe(mockOrgId)
      expect(deptId).toBe(mockDeptId)
      expect(chunks).toHaveLength(1)

      const chunk = chunks[0]
      expect(chunk.chunk_id).toBe('confluence-page-page-1')
      expect(chunk.title).toBe('Test Page')
      expect(chunk.source_url).toContain('athene-ai.atlassian.net')
      // HTML tags must be stripped from content
      expect(chunk.content).not.toContain('<h1>')
      expect(chunk.content).toContain('Hello')
      expect(chunk.content).toContain('Some content here')
      expect(chunk.metadata.provider).toBe('confluence')
      expect(chunk.metadata.resource_type).toBe('page')
      expect(chunk.metadata.space_key).toBe('SPACE')
      expect(chunk.metadata.labels).toEqual(['internal'])
      // Ensure no content-bearing keys leaked into metadata
      expect(chunk.metadata).not.toHaveProperty('content')
    })

    it('indexConfluenceSpace skips empty pages', async () => {
      ;(client.atlassianFetch as any).mockResolvedValueOnce({
        results: [
          { ...mockPage, id: 'empty-page', body: { storage: { value: '   ' } } },
        ],
        _links: {},
      })

      const result = await indexConfluenceSpace(mockConnId, 'SPACE', mockOrgId, mockDeptId)

      // Empty content — indexDocuments should not be called
      expect(indexDocuments).not.toHaveBeenCalled()
      expect(result).toEqual({ indexed: 0, failed: 0 })
    })

    it('indexConfluenceSpace handles pagination via _links.next', async () => {
      ;(client.atlassianFetch as any)
        .mockResolvedValueOnce({ results: [mockPage], _links: { next: '/next' } })
        .mockResolvedValueOnce({ results: [mockPage], _links: {} })

      await indexConfluenceSpace(mockConnId, 'SPACE', mockOrgId, mockDeptId)

      expect(client.atlassianFetch).toHaveBeenCalledTimes(2)
      expect(indexDocuments).toHaveBeenCalledTimes(2)
    })
  })
})
