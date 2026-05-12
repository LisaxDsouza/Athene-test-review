import Anthropic from "@anthropic-ai/sdk";
import type { ExtractorChunk, RawExtraction } from "./types";

const PROVIDER_HINTS: Record<string, string> = {
  slack:       "Focus on people, projects, decisions, and action items from conversations.",
  snowflake:   "Focus on data entities, metrics, dimensions, and relationships between tables.",
  hubspot:     "Focus on contacts, companies, deals, and pipeline stages.",
  salesforce:  "Focus on accounts, opportunities, leads, and sales activities.",
  confluence:  "Focus on teams, projects, policies, and documented decisions.",
  github:      "Focus on repositories, issues, pull requests, contributors, and code modules.",
  linear:      "Focus on projects, cycles, issues, assignees, and labels.",
  jira:        "Focus on epics, stories, tasks, assignees, and sprints.",
};

function buildExtractionPrompt(sourceType?: string): string {
  const hint = sourceType ? (PROVIDER_HINTS[sourceType] ?? "") : "";
  return `Extract a knowledge graph from the text below.
${hint ? `Context hint: ${hint}\n` : ""}
Return ONLY valid JSON matching this schema — no markdown fences, no explanation:
{
  "nodes": [{ "id": "string", "label": "string", "type": "string", "properties": {} }],
  "edges": [{ "from": "string", "to": "string", "relation": "string", "weight": 0.8 }]
}

Rules:
- node id must be a stable slug (snake_case, no spaces)
- node type: one of person | org | project | concept | metric | location | event | document
- edge weight: 0.0–1.0 (confidence)
- Extract only what is explicitly stated; do not infer

Text:
`;
}

export async function extractKGFromChunk(
  chunk: ExtractorChunk,
  apiKey: string,
): Promise<RawExtraction> {
  const client = new Anthropic({ apiKey });
  const prompt = buildExtractionPrompt(chunk.source_type);

  const response = await client.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 1024,
    messages: [{ role: "user", content: prompt + chunk.content }],
  });

  const text =
    response.content[0]?.type === "text" ? response.content[0].text : "";

  try {
    // Strip possible markdown fences if the model wraps despite instructions
    const clean = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
    return JSON.parse(clean) as RawExtraction;
  } catch {
    console.warn("[kg-extractor] Failed to parse extraction for chunk", chunk.chunk_index);
    return { nodes: [], edges: [] };
  }
}
