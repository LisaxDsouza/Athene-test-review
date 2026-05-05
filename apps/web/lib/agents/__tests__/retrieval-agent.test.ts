import { describe, it, expect, vi, beforeEach } from "vitest";
import { retrievalAgent } from "../retrieval-agent";
import { vectorSearch } from "../../tools/vector-search";

vi.mock("../../tools/vector-search", () => ({
  vectorSearch: vi.fn(),
}));

describe("retrievalAgent", () => {
  const mockUser = { id: "user_1", orgId: "org_1", role: "admin" };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls vectorSearch with correct parameters and updates state", async () => {
    const mockResults = [
      {
        chunk_id: "c1",
        document_id: "d1",
        score: 0.95,
        preview: "Found some info",
        metadata: { content: "Found some info" },
      },
    ];


    (vectorSearch as any).mockResolvedValue(mockResults);

    const state: any = {
      query: "find me info",
      user: mockUser,
    };

    const update = await retrievalAgent(state);

    expect(vectorSearch).toHaveBeenCalledWith({
      orgId: mockUser.orgId,
      userId: mockUser.id,
      role: mockUser.role,
      query: "find me info",
      topK: 8,
    });

    expect(update.retrieval_results).toHaveLength(1);
    expect(update.retrieval_results[0]).toEqual({
      chunk_id: "c1",
      document_id: "d1",
      score: 0.95,
      preview: "Found some info",
      metadata: { content: "Found some info" },
    });
    expect(update.next_agent).toBeUndefined();
  });

  it("handles empty results by setting next_agent to END", async () => {
    (vectorSearch as any).mockResolvedValue([]);

    const state: any = {
      query: "nonexistent",
      user: mockUser,
    };

    const update = await retrievalAgent(state);

    expect(update.next_agent).toBe("END");
    expect(update.message).toBe("No relevant docs found");
    expect(update.retrieval_results).toBeUndefined();
  });

  it("handles missing query or user gracefully", async () => {
    const state: any = {};
    const update = await retrievalAgent(state);

    expect(update.next_agent).toBe("END");
    expect(update.message).toBe("Missing query or user context");
  });
});
