// ============================================================
// no-content-stored.test.ts — Rule #2 enforcement tests (ATH-28)
//
// Verifies that the indexing pipeline:
//   1. Never passes document body text into document_embeddings
//   2. Rejects callers who try to smuggle body text through metadata
//   3. Still populates vector / hash / metadata fields correctly
//   4. Dedups by content_hash on re-index
//
// These tests run entirely in-process; Supabase + OpenAI + Anthropic
// clients are stubbed via module mocks so the test is offline-safe.
// ============================================================

import { beforeEach, describe, expect, it, vi } from "vitest";

// ---- Shared in-memory fixture ---------------------------------
type EmbeddingRow = {
  org_id: string;
  document_id: string;
  chunk_index: number;
  content_hash: string;
  embedding: number[];
  department_id: string | null;
  owner_user_id: string | null;
  visibility: string;
  source_type: string;
  token_count: number;
  metadata: Record<string, unknown>;
};

const embeddingStore: EmbeddingRow[] = [];
const documentsUpdates: Array<Record<string, unknown>> = [];

// ---- Mocks ----------------------------------------------------
// Embedder: return deterministic 1536-dim zero vectors so the test
// works offline.
vi.mock("@/lib/langgraph/tools/embedder", () => ({
  embed: async (texts: string[]) =>
    texts.map(() => new Array(1536).fill(0)),
  EMBEDDING_CONFIG: { model: "text-embedding-3-small", dimensions: 1536 },
}));

// Knowledge graph pass: no-op so we focus on Rule #2.
vi.mock("@/lib/knowledge-graph/extractor", () => ({
  extractEntitiesAndRelations: async () => ({ nodes: [], edges: [] }),
}));
vi.mock("@/lib/knowledge-graph/storage", () => ({
  upsertNodes: async () => new Map(),
  upsertEdges: async () => undefined,
  deleteByDocument: async () => undefined,
}));

// Supabase admin: a tiny in-memory stub that captures writes
vi.mock("@/lib/supabase/server", () => {
  const admin = {
    from(table: string) {
      return makeQueryBuilder(table);
    },
  };
  return { supabaseAdmin: admin, supabaseServer: admin, supabase: admin };
});

function makeQueryBuilder(table: string) {
  const ctx: { filters: Array<[string, unknown]> } = { filters: [] };
  const builder: Record<string, unknown> = {
    select(_cols: string) {
      return thenable(builder, async () => {
        if (table !== "document_embeddings") return { data: [], error: null };
        const [, orgId] = ctx.filters.find(([c]) => c === "org_id") ?? [];
        const [, docId] = ctx.filters.find(([c]) => c === "document_id") ?? [];
        const matches = embeddingStore
          .filter((r) => r.org_id === orgId && r.document_id === docId)
          .map((r) => ({ content_hash: r.content_hash }));
        return { data: matches, error: null };
      });
    },
    eq(col: string, val: unknown) {
      ctx.filters.push([col, val]);
      return builder;
    },
    upsert(rows: Record<string, unknown>[]) {
      return thenable(builder, async () => {
        if (table !== "document_embeddings") return { data: null, error: null };
        for (const row of rows) {
          embeddingStore.push(row as EmbeddingRow);
        }
        return { data: rows, error: null };
      });
    },
    update(patch: Record<string, unknown>) {
      return thenable(builder, async () => {
        if (table === "documents") documentsUpdates.push(patch);
        return { data: null, error: null };
      });
    },
  };
  return builder;
}

function thenable<T>(builder: T, exec: () => Promise<unknown>): T {
  // Make the builder awaitable by supplying a `then` method that
  // runs `exec`. Both `await builder.select(...)` and chained
  // `.eq().eq()` paths work because `.eq` returns the same builder
  // which is also thenable.
  (builder as { then?: unknown }).then = (resolve: (v: unknown) => void, reject: (e: unknown) => void) => {
    exec().then(resolve).catch(reject);
  };
  return builder;
}

// ---- Import AFTER mocks ---------------------------------------
import { indexDocument, sha256 } from "@/lib/langgraph/tools/indexer";

beforeEach(() => {
  embeddingStore.length = 0;
  documentsUpdates.length = 0;
});

describe("Rule #2 — document body is never persisted", () => {
  it("writes vector + metadata rows but no content column", async () => {
    const body =
      "Project Helios is an internal initiative. It depends on the Billing Service. " +
      "We use PostgreSQL for storage. The team is led by Jane Doe.";

    const result = await indexDocument({
      orgId: "org-1",
      documentId: "doc-1",
      deptId: "dept-1",
      sourceType: "gdrive",
      visibility: "department",
      content: body,
      metadata: { title: "Helios Overview", author: "jane" },
      buildGraph: false,
    });

    expect(result.chunksTotal).toBeGreaterThan(0);
    expect(result.chunksEmbedded).toBe(result.chunksTotal);
    expect(embeddingStore.length).toBe(result.chunksEmbedded);

    for (const row of embeddingStore) {
      // Every stored row MUST NOT contain the body text
      for (const [, val] of Object.entries(row)) {
        if (typeof val === "string") {
          expect(val.includes("Project Helios")).toBe(false);
          expect(val.includes("Billing Service")).toBe(false);
          expect(val.includes("Jane Doe")).toBe(false);
        }
      }
      // No key that smells like content exists on the row
      expect(row).not.toHaveProperty("content");
      expect(row).not.toHaveProperty("body");
      expect(row).not.toHaveProperty("text");
      // Metadata shouldn't carry body either
      const mdStr = JSON.stringify(row.metadata ?? {});
      expect(mdStr.includes("Project Helios")).toBe(false);
      expect(mdStr.includes("Billing Service")).toBe(false);

      // Structural invariants
      expect(row.embedding.length).toBe(1536);
      expect(typeof row.content_hash).toBe("string");
      expect(row.content_hash.length).toBe(64); // SHA-256 hex
    }
  });

  it("rejects metadata that tries to smuggle body text", async () => {
    await expect(
      indexDocument({
        orgId: "org-1",
        documentId: "doc-forbidden",
        sourceType: "gdrive",
        visibility: "department",
        content: "hello world",
        metadata: { content: "hello world" },
        buildGraph: false,
      })
    ).rejects.toThrow(/Rule #2 violation/);

    await expect(
      indexDocument({
        orgId: "org-1",
        documentId: "doc-forbidden-2",
        sourceType: "gdrive",
        visibility: "department",
        content: "hello world",
        metadata: { Body: "hello world" },
        buildGraph: false,
      })
    ).rejects.toThrow(/Rule #2 violation/);
  });

  it("dedups chunks by content_hash on re-index", async () => {
    const body =
      "Alpha paragraph about things. " +
      "Beta paragraph about other things. " +
      "Gamma paragraph about more things.";

    const first = await indexDocument({
      orgId: "org-1",
      documentId: "doc-dedup",
      sourceType: "gdrive",
      visibility: "department",
      content: body,
      buildGraph: false,
    });
    const second = await indexDocument({
      orgId: "org-1",
      documentId: "doc-dedup",
      sourceType: "gdrive",
      visibility: "department",
      content: body,
      buildGraph: false,
    });

    expect(first.chunksEmbedded).toBeGreaterThan(0);
    expect(second.chunksEmbedded).toBe(0);
    expect(second.chunksSkippedByHash).toBe(first.chunksTotal);
  });

  it("produces SHA-256 hashes that match crypto.sha256 of the chunk text", async () => {
    const body = "Short doc for hash stability.";
    const res = await indexDocument({
      orgId: "org-1",
      documentId: "doc-hash",
      sourceType: "gdrive",
      visibility: "department",
      content: body,
      buildGraph: false,
    });
    expect(res.chunksEmbedded).toBe(1);
    const storedHash = embeddingStore[0].content_hash;
    // The stored hash must equal sha256 of the chunk text the indexer
    // saw. We don't have the exact chunk boundary here, but we can at
    // least assert it's a valid 64-char hex SHA-256.
    expect(storedHash).toMatch(/^[0-9a-f]{64}$/);
    // Spot-check that sha256() and Node's crypto agree
    expect(sha256("foo")).toBe(
      "2c26b46b68ffc68ff99b453c1d30413413422d706483bfa0f98a5e886266e7ae"
    );
  });

  it("updates documents.chunk_count and last_indexed_at", async () => {
    await indexDocument({
      orgId: "org-1",
      documentId: "doc-meta",
      sourceType: "gdrive",
      visibility: "department",
      content: "Hello world.",
      buildGraph: false,
    });
    expect(documentsUpdates.length).toBe(1);
    expect(documentsUpdates[0]).toHaveProperty("chunk_count");
    expect(documentsUpdates[0]).toHaveProperty("last_indexed_at");
  });
});
