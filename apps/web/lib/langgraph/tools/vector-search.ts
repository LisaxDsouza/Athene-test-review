import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { vectorSearch, crossDeptVectorSearch } from "@/lib/tools/vector-search";

export const vectorSearchTool = new DynamicStructuredTool({
  name: "vectorSearch",
  description:
    "Search organization documents using semantic vector similarity. Use for general knowledge queries.",
  schema: z.object({
    query: z.string().describe("The search query"),
    topK: z
      .number()
      .optional()
      .default(5)
      .describe("Number of results to return"),
  }),
  func: async ({ query, topK = 5 }, _runManager, config) => {
    const orgId =
      config?.configurable?.orgId ?? config?.metadata?.orgId ?? "";
    const userId =
      config?.configurable?.userId ?? config?.metadata?.userId ?? "";
    const role =
      config?.configurable?.role ?? config?.metadata?.role ?? "member";

    const results = await vectorSearch({ orgId, userId, user_role: role, query, topK });
    return JSON.stringify({ tool: "vectorSearch", query, results });
  },
});

export const crossDeptVectorSearchTool = new DynamicStructuredTool({
  name: "crossDeptVectorSearch",
  description:
    "Cross-department vector search restricted to super_user (BI Analyst) role. Returns bi_accessible documents only.",
  schema: z.object({
    query: z.string().describe("The search query"),
    topK: z
      .number()
      .optional()
      .default(5)
      .describe("Number of results to return"),
  }),
  func: async ({ query, topK = 5 }, _runManager, config) => {
    const orgId =
      config?.configurable?.orgId ?? config?.metadata?.orgId ?? "";
    const userId =
      config?.configurable?.userId ?? config?.metadata?.userId ?? "";
    const role =
      config?.configurable?.role ?? config?.metadata?.role ?? "member";

    const results = await crossDeptVectorSearch({
      orgId,
      userId,
      user_role: role,
      query,
      topK,
    });
    return JSON.stringify({ tool: "crossDeptVectorSearch", query, results });
  },
});
