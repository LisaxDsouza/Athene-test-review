// ============================================================
// chunker.ts — Text → token-bounded chunks (ATH-28)
//
// Rule #2: chunk text only exists in RAM. It enters as an argument
// and leaves as an array of { text, chunk_index } that the caller
// is expected to discard after embedding. Nothing is persisted here.
// ============================================================

import { encode, decode } from "gpt-tokenizer";

export type Chunk = {
  text: string;
  chunk_index: number;
};

export type ChunkOptions = {
  /** Tokens per chunk. Default 512. */
  chunkSize?: number;
  /** Overlap between consecutive chunks in tokens. Default 64. */
  overlap?: number;
};

const DEFAULT_CHUNK_SIZE = 512;
const DEFAULT_OVERLAP = 64;

/**
 * Splits `text` into token-bounded chunks with overlap.
 *
 * Uses cl100k_base tokenizer (OpenAI's text-embedding-3-small /
 * gpt-4o family). Chunk boundaries are exact token offsets —
 * decode gives us back the substring.
 */
export function chunk(text: string, options: ChunkOptions = {}): Chunk[] {
  const chunkSize = options.chunkSize ?? DEFAULT_CHUNK_SIZE;
  const overlap = options.overlap ?? DEFAULT_OVERLAP;

  if (chunkSize <= 0) throw new Error("chunkSize must be > 0");
  if (overlap < 0 || overlap >= chunkSize) {
    throw new Error("overlap must be >= 0 and < chunkSize");
  }

  const trimmed = text?.trim();
  if (!trimmed) return [];

  const tokens = encode(trimmed);
  if (tokens.length === 0) return [];

  // Single chunk shortcut
  if (tokens.length <= chunkSize) {
    return [{ text: trimmed, chunk_index: 0 }];
  }

  const chunks: Chunk[] = [];
  const stride = chunkSize - overlap;
  let start = 0;
  let idx = 0;

  while (start < tokens.length) {
    const end = Math.min(start + chunkSize, tokens.length);
    const slice = tokens.slice(start, end);
    const chunkText = decode(slice).trim();
    if (chunkText.length > 0) {
      chunks.push({ text: chunkText, chunk_index: idx });
      idx += 1;
    }
    if (end === tokens.length) break;
    start += stride;
  }

  return chunks;
}

/** Count tokens for a string using the same tokenizer as chunk(). */
export function countTokens(text: string): number {
  if (!text) return 0;
  return encode(text).length;
}
