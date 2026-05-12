/**
 * lib/integrations/indexing.ts
 *
 * Content-type-aware chunking for the document indexing pipeline.
 *
 * Each source type gets a strategy that balances chunk size against
 * context coherence:
 *  - prose (Google Docs, Confluence, Notion)  → heading splits + 2200-char window
 *  - structured rows (Snowflake, CSV, DB)      → 15 rows/chunk with header repeat
 *  - threaded (Slack, email, GitHub issues)    → reply/message boundaries
 *  - markdown (GitHub README, wikis, Linear)   → heading splits + atomic code fences
 */

export type ChunkStrategy = "prose" | "structured" | "threaded" | "markdown";

const PROSE_CHUNK_SIZE    = 2200;
const PROSE_OVERLAP       = 260;
const STRUCTURED_ROW_SIZE = 15;

// ─── Prose ────────────────────────────────────────────────────────────────────

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function splitByHeadings(text: string): string[] {
  // Split on markdown headings or ALL-CAPS lines that act as section headers
  const parts = text.split(/(?=^#{1,3}\s|\n[A-Z][A-Z\s]{4,}\n)/m);
  return parts.map((p) => p.trim()).filter(Boolean);
}

export function chunkProse(content: string): string[] {
  const clean = content.includes("<") ? stripHtml(content) : content;
  const sections = splitByHeadings(clean);
  const chunks: string[] = [];

  for (const section of sections) {
    if (section.length <= PROSE_CHUNK_SIZE) {
      chunks.push(section);
    } else {
      // Sliding window for long sections
      for (let i = 0; i < section.length; i += PROSE_CHUNK_SIZE - PROSE_OVERLAP) {
        const slice = section.slice(i, i + PROSE_CHUNK_SIZE).trim();
        if (slice) chunks.push(slice);
      }
    }
  }

  return chunks.filter((c) => c.length > 0);
}

// ─── Structured rows ──────────────────────────────────────────────────────────

export function chunkStructuredRows(content: string): string[] {
  const lines = content.split("\n");
  const header = lines[0] ?? "";
  const rows   = lines.slice(1);
  const chunks: string[] = [];

  for (let i = 0; i < rows.length; i += STRUCTURED_ROW_SIZE) {
    const batch = rows.slice(i, i + STRUCTURED_ROW_SIZE).join("\n").trim();
    if (batch) chunks.push(`${header}\n${batch}`);
  }

  return chunks;
}

// ─── Threaded ─────────────────────────────────────────────────────────────────

export function chunkThreaded(content: string): string[] {
  // Split on Slack-style timestamps, email "From:" headers, or GitHub comment separators
  const boundaries = /(?:^|\n)(?=\[\d{4}-\d{2}-\d{2}|From:\s|---+\n)/;
  const parts = content.split(boundaries);
  return parts.map((p) => p.trim()).filter(Boolean);
}

// ─── Markdown ─────────────────────────────────────────────────────────────────

export function chunkMarkdown(content: string): string[] {
  // Preserve atomic code fences — split on headings OUTSIDE fences
  const chunks: string[] = [];
  let current = "";
  let inFence = false;

  for (const line of content.split("\n")) {
    if (line.startsWith("```") || line.startsWith("~~~")) {
      inFence = !inFence;
      current += line + "\n";
      continue;
    }

    if (!inFence && /^#{1,3}\s/.test(line) && current.trim()) {
      chunks.push(current.trim());
      current = line + "\n";
    } else {
      current += line + "\n";
      // Also break on oversized non-heading sections
      if (!inFence && current.length > PROSE_CHUNK_SIZE) {
        chunks.push(current.trim());
        current = "";
      }
    }
  }

  if (current.trim()) chunks.push(current.trim());
  return chunks.filter(Boolean);
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Selects a chunking strategy based on source type and optional resource type hint,
 * then splits `content` into chunks.
 */
export function chunkByType(
  content: string,
  sourceType: string,
  metadata?: { resource_type?: string },
): string[] {
  const strategy = resolveStrategy(sourceType, metadata?.resource_type);

  switch (strategy) {
    case "structured": return chunkStructuredRows(content);
    case "threaded":   return chunkThreaded(content);
    case "markdown":   return chunkMarkdown(content);
    default:           return chunkProse(content);
  }
}

function resolveStrategy(
  sourceType: string,
  resourceType?: string,
): ChunkStrategy {
  // Structured data sources
  if (
    sourceType === "snowflake" ||
    sourceType === "bigquery" ||
    resourceType === "csv" ||
    resourceType === "table"
  ) return "structured";

  // Threaded conversation sources
  if (
    sourceType === "slack" ||
    sourceType === "email" ||
    resourceType === "thread" ||
    resourceType === "issue_comments"
  ) return "threaded";

  // Markdown-first sources
  if (
    sourceType === "github" ||
    sourceType === "linear" ||
    sourceType === "jira" ||
    resourceType === "readme" ||
    resourceType === "wiki"
  ) return "markdown";

  // Default: prose (Google Docs, SharePoint, Confluence, Notion)
  return "prose";
}

/**
 * Convenience wrapper used by indexing workers.
 * Returns chunk objects ready for the embeddings pipeline.
 */
export function indexDocument(
  content: string,
  sourceType: string,
  metadata?: { resource_type?: string },
): Array<{ content: string; chunk_index: number; chunk_strategy: ChunkStrategy }> {
  const strategy = resolveStrategy(sourceType, metadata?.resource_type);
  const chunks   = chunkByType(content, sourceType, metadata);

  return chunks.map((text, i) => ({
    content: text,
    chunk_index: i,
    chunk_strategy: strategy,
  }));
}
