import { googleFetch, googleFetchRaw } from './api-client'
import type { FetchedChunk } from '@/lib/integrations/base'
import { assertSafeMetadata } from '@/lib/integrations/base'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DriveFile {
  id: string
  name: string
  mimeType: string
  webViewLink?: string
  modifiedTime?: string
  owners?: Array<{ displayName: string; emailAddress: string }>
}

export interface DriveListResponse {
  files: DriveFile[]
  nextPageToken?: string
}

export interface DriveChange {
  fileId: string
  removed: boolean
  file?: DriveFile
}

export interface DriveChangesResponse {
  changes: DriveChange[]
  newPageToken: string
}

// ─── Google MIME type constants ───────────────────────────────────────────────

const GOOGLE_DOC_MIME = 'application/vnd.google-apps.document'
const GOOGLE_SHEET_MIME = 'application/vnd.google-apps.spreadsheet'
const GOOGLE_SLIDES_MIME = 'application/vnd.google-apps.presentation'
const GOOGLE_FOLDER_MIME = 'application/vnd.google-apps.folder'

/** MIME types we can extract real text from */
const EXTRACTABLE_BINARY: Record<string, 'pdf' | 'docx'> = {
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
}

// ─── Listing & Searching ─────────────────────────────────────────────────────

/**
 * Lists files in a user's Google Drive.
 *
 * @param connectionId - Nango connection ID.
 * @param orgId - Organization ID for ownership verification.
 * @param folderId - Optional folder to scope the listing to.
 * @param pageToken - Optional pagination token from a previous response.
 * @param pageSize - Number of results per page (default 50, max 1000).
 */
export async function listDriveFiles(
  connectionId: string,
  orgId: string,
  folderId?: string,
  pageToken?: string,
  pageSize: number = 50
): Promise<DriveListResponse> {
  const q = folderId
    ? `'${folderId}' in parents and trashed=false`
    : 'trashed=false'

  const params = new URLSearchParams({
    q,
    fields: 'files(id,name,mimeType,webViewLink,modifiedTime,owners),nextPageToken',
    pageSize: String(pageSize),
  })
  if (pageToken) params.set('pageToken', pageToken)

  const url = `https://www.googleapis.com/drive/v3/files?${params.toString()}`
  return googleFetch<DriveListResponse>(connectionId, orgId, url)
}

/**
 * Full-text search across a user's Google Drive.
 *
 * @param connectionId - Nango connection ID.
 * @param orgId - Organization ID for ownership verification.
 * @param query - The search string.
 * @param pageToken - Optional pagination token.
 */
export async function searchDrive(
  connectionId: string,
  orgId: string,
  query: string,
  pageToken?: string
): Promise<DriveListResponse> {
  const escapedQuery = query.replace(/'/g, "\\'")
  const q = `fullText contains '${escapedQuery}' and trashed=false`

  const params = new URLSearchParams({
    q,
    fields: 'files(id,name,mimeType,webViewLink,modifiedTime,owners),nextPageToken',
    pageSize: '20',
  })
  if (pageToken) params.set('pageToken', pageToken)

  const url = `https://www.googleapis.com/drive/v3/files?${params.toString()}`
  return googleFetch<DriveListResponse>(connectionId, orgId, url)
}

// ─── Content Extraction ──────────────────────────────────────────────────────

/**
 * Fetches the text content of a Google Drive file.
 * Routes to the correct endpoint based on MIME type:
 * - Google Docs → exported as text/plain
 * - Google Sheets → exported as CSV
 * - Google Slides → exported as text/plain
 * - PDF → downloaded via alt=media, extracted with pdf-parse
 * - DOCX → downloaded via alt=media, extracted with mammoth
 * - Other text/* → downloaded via alt=media, decoded as UTF-8
 *
 * @param connectionId - Nango connection ID.
 * @param orgId - Organization ID for ownership verification.
 * @param fileId - The Drive file ID.
 * @param mimeType - The file's MIME type from the listing response.
 * @returns The extracted text content as a string.
 */
export async function fetchDriveFileContent(
  connectionId: string,
  orgId: string,
  fileId: string,
  mimeType: string
): Promise<string> {
  if (mimeType === GOOGLE_DOC_MIME) {
    const url = `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=text/plain`
    return googleFetch<string>(connectionId, orgId, url)
  }

  if (mimeType === GOOGLE_SHEET_MIME) {
    const url = `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=text/csv`
    return googleFetch<string>(connectionId, orgId, url)
  }

  if (mimeType === GOOGLE_SLIDES_MIME) {
    const url = `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=text/plain`
    return googleFetch<string>(connectionId, orgId, url)
  }

  if (mimeType === GOOGLE_FOLDER_MIME) {
    return '[Google Drive Folder — no content to extract]'
  }

  // Regular files (PDF, DOCX, TXT, etc.) → download raw bytes
  const url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`
  const res = await googleFetchRaw(connectionId, orgId, url)
  const buffer = await res.arrayBuffer()

  // Plain text files can be returned directly
  if (mimeType.startsWith('text/')) {
    return new TextDecoder().decode(buffer)
  }

  // PDF → extract text with pdf-parse
  if (EXTRACTABLE_BINARY[mimeType] === 'pdf') {
    return extractPdfText(Buffer.from(buffer))
  }

  // DOCX → extract text with mammoth
  if (EXTRACTABLE_BINARY[mimeType] === 'docx') {
    return extractDocxText(Buffer.from(buffer))
  }

  // Unsupported binary — return a stub (images, videos, etc.)
  return `[Unsupported binary format: ${mimeType}] (${buffer.byteLength} bytes)`
}

// ─── Binary Text Extraction ─────────────────────────────────────────────────

/**
 * Extracts text from a PDF buffer using pdf-parse.
 * Falls back gracefully if the PDF is image-only or corrupted.
 */
async function extractPdfText(buffer: Buffer): Promise<string> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pdfParse = require('pdf-parse') as (buf: Buffer) => Promise<{ text: string }>
    const data = await pdfParse(buffer)
    const text = data.text?.trim()
    if (!text) return '[PDF contains no extractable text (image-only?)]'
    return text
  } catch (err) {
    console.warn('[drive-fetcher] PDF extraction failed:', err)
    return '[PDF text extraction failed]'
  }
}

/**
 * Extracts text from a DOCX buffer using mammoth.
 * Falls back gracefully if the document is corrupted.
 */
async function extractDocxText(buffer: Buffer): Promise<string> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mammoth = require('mammoth') as { extractRawText: (opts: { buffer: Buffer }) => Promise<{ value: string }> }
    const result = await mammoth.extractRawText({ buffer })
    const text = result.value?.trim()
    if (!text) return '[DOCX contains no extractable text]'
    return text
  } catch (err) {
    console.warn('[drive-fetcher] DOCX extraction failed:', err)
    return '[DOCX text extraction failed]'
  }
}

// ─── FetchedChunk Builders ──────────────────────────────────────────────────

/**
 * Converts a DriveFile + its extracted content into a FetchedChunk
 * ready for the indexing pipeline (indexDocument).
 *
 * @param file - The DriveFile metadata from the listing.
 * @param content - The extracted text content from fetchDriveFileContent.
 * @returns A FetchedChunk that can be passed to indexDocument.
 */
export function driveFileToChunk(file: DriveFile, content: string): FetchedChunk {
  const metadata: FetchedChunk['metadata'] = {
    provider: 'google',
    resource_type: 'drive_file',
    last_modified: file.modifiedTime,
    author: file.owners?.[0]?.displayName,
    mime_type: file.mimeType,
  }
  assertSafeMetadata(metadata)

  return {
    chunk_id: `drive:${file.id}`,
    title: file.name,
    content,
    source_url: file.webViewLink || `https://drive.google.com/file/d/${file.id}`,
    metadata,
  }
}

/**
 * Full indexing pipeline entry point for Drive.
 * Lists all files, fetches content for each, and returns FetchedChunk[].
 * Skips folders and files that fail extraction (logs warnings instead of throwing).
 *
 * @param connectionId - Nango connection ID.
 * @param orgId - Organization ID for ownership verification.
 * @param folderId - Optional folder to scope the listing to.
 * @returns Array of FetchedChunks ready for indexDocument.
 */
export async function fetchDriveChunks(
  connectionId: string,
  orgId: string,
  folderId?: string,
): Promise<FetchedChunk[]> {
  const chunks: FetchedChunk[] = []
  let pageToken: string | undefined

  do {
    const listing = await listDriveFiles(connectionId, orgId, folderId, pageToken)

    for (const file of listing.files) {
      // Skip folders — they have no content
      if (file.mimeType === GOOGLE_FOLDER_MIME) continue

      try {
        const content = await fetchDriveFileContent(connectionId, orgId, file.id, file.mimeType)

        // Skip stubs that indicate extraction failure
        if (content.startsWith('[Unsupported binary format:')) continue

        chunks.push(driveFileToChunk(file, content))
      } catch (err) {
        console.warn(`[drive-fetcher] Skipping file ${file.id} (${file.name}):`, err)
      }
    }

    pageToken = listing.nextPageToken
  } while (pageToken)

  return chunks
}

// ─── Delta Sync (Changes API) ────────────────────────────────────────────────

/**
 * Retrieves a start page token for Google Drive's Changes API.
 */
export async function getStartPageToken(
  connectionId: string,
  orgId: string
): Promise<string> {
  const url = 'https://www.googleapis.com/drive/v3/changes/startPageToken'
  const res = await googleFetch<{ startPageToken: string }>(connectionId, orgId, url)
  return res.startPageToken
}

/**
 * Fetches changes since the given page token.
 * Returns only modified/removed files and a new token for the next poll cycle.
 */
export async function fetchChanges(
  connectionId: string,
  orgId: string,
  pageToken: string
): Promise<DriveChangesResponse> {
  const params = new URLSearchParams({
    pageToken,
    fields: 'changes(fileId,removed,file(id,name,mimeType,modifiedTime)),newStartPageToken,nextPageToken',
  })

  const url = `https://www.googleapis.com/drive/v3/changes?${params.toString()}`
  const res = await googleFetch<{
    changes: DriveChange[]
    newStartPageToken?: string
    nextPageToken?: string
  }>(connectionId, orgId, url)

  return {
    changes: res.changes || [],
    newPageToken: res.newStartPageToken || res.nextPageToken || pageToken,
  }
}
