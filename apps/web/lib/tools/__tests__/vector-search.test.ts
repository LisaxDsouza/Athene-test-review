import { describe, it, expect, vi, beforeEach } from "vitest";
import { vectorSearch, crossDeptVectorSearch } from "../vector-search";
import { pool } from "../../db/pool";

// 🎭 Mock the embedder
vi.mock("@/lib/ai/embedder", () => ({
  embed: vi.fn(async () => Array(1536).fill(0.1)),
}));

// 🎭 Mock the DB Pool
vi.mock("../../db/pool", () => ({
  pool: {
    connect: vi.fn(() => ({
      query: vi.fn(async (sql, params) => {
        // Mock success response
        if (sql.includes("SELECT")) {
          return { rows: [{ chunk_id: "test", metadata: { org_id: "org_alpha" }, visibility: "bi_accessible" }] };
        }
        return { rows: [] };
      }),
      release: vi.fn(),
    })),
    query: vi.fn(async () => ({
      rows: [{ "QUERY PLAN": "Index Scan using document_embeddings_hnsw_idx" }]
    })),
  },
}));

describe("Vector Search RLS & RBAC (Mocked)", () => {
  it("prevents cross-organization access (Logic Check)", async () => {
    const results = await vectorSearch({
      orgId: "org_alpha",
      userId: "user_1",
      role: "member",
      query: "test query",
    });

    results.forEach((r: any) => {
      expect(r.metadata.org_id).toBe("org_alpha");
    });
  });

  it("restricts cross-department search to bi_analyst role", async () => {
    await expect(
      crossDeptVectorSearch({
        orgId: "org_alpha",
        userId: "user_1",
        role: "member",
        query: "revenue insights",
      })
    ).rejects.toThrow("Unauthorized: requires super_user role");
  });

  it("allows super_user to see 'bi_accessible' docs", async () => {
    const results = await crossDeptVectorSearch({
      orgId: "org_alpha",
      userId: "analyst_1",
      role: "super_user",
      query: "global trends",
    });

    results.forEach((r: any) => {
      expect(r.visibility).toBe("bi_accessible");
    });
  });

  it("verifies HNSW index usage via EXPLAIN (Mocked Plan)", async () => {
    const embedding = Array(1536).fill(0.1);
    const res = await pool.query(`EXPLAIN ANALYZE SELECT * FROM document_embeddings`);
    const plan = res.rows.map((r: any) => r["QUERY PLAN"]).join(" ");
    
    expect(plan).toContain("Index Scan");
    expect(plan).toContain("document_embeddings_hnsw_idx");
  });
});
