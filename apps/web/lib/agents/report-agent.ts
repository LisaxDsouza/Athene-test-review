import type { AtheneStateType, AtheneStateUpdate } from "../langgraph/state";
import { vectorSearch } from "../tools/vector-search";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import { ChatOpenAI } from "@langchain/openai";
import type { MessageContentComplex } from "@langchain/core/messages";

// Lightweight model for the planning step — only produces a JSON array of titles.
const plannerModel = new ChatOpenAI({ modelName: "gpt-4o-mini", temperature: 0 });
// Slightly higher temperature for prose generation
const synthesisModel = new ChatOpenAI({ modelName: "gpt-4o-mini", temperature: 0.2 });

// Inlined prompt template — avoids fs.readFileSync which crashes in Edge Runtime.
const PLAN_PROMPT_TEMPLATE = `# Report Planning Prompt

You are an expert analyst tasked with planning a comprehensive report.
Given the user's query, your job is to outline a structured report by breaking it down into logical sections.

Return a JSON array containing 3 to 6 section titles.
Each section title should be a concise string representing a distinct topic to be covered in the report.

Query: {{query}}

Example Output:
["Executive Summary", "Key Metrics", "Recent Developments", "Challenges & Risks", "Conclusion"]`;

/**
 * Extract plain text from a LangChain message content value.
 *
 * LangChain `.content` can be a plain string OR a MessageContentComplex[] (e.g. vision
 * or tool-result blocks). Template-string interpolation of an array produces the
 * infamous "[object Object]" string, so we normalise here instead.
 */
function extractText(
  content: string | MessageContentComplex[],
  fallback = "Generate a report"
): string {
  if (typeof content === "string") return content || fallback;
  const text = content
    .filter(
      (block): block is { type: "text"; text: string } =>
        typeof block === "object" &&
        block !== null &&
        "type" in block &&
        block.type === "text"
    )
    .map((block) => block.text)
    .join(" ")
    .trim();
  return text || fallback;
}

export async function reportAgent(
  state: AtheneStateType,
  _config: unknown
): Promise<AtheneStateUpdate> {
  const {
    orgId,
    userId,
    role,
    messages,
  } = state;

  // Extract the latest query — safe against MessageContentComplex[].
  const lastMessage =
    messages && messages.length > 0 ? messages[messages.length - 1] : null;
  const query: string = lastMessage
    ? extractText(
        lastMessage.content as string | MessageContentComplex[]
      )
    : "Generate a report";

  // 1. Plan sections using LLM
  const planPrompt = PLAN_PROMPT_TEMPLATE.replace("{{query}}", query);

  const planResponse = await plannerModel.invoke([
    new SystemMessage(planPrompt),
  ]);

  let sections: string[] = [];
  try {
    let rawContent = extractText(
      planResponse.content as string | MessageContentComplex[]
    );
    // Strip markdown code fences if the model wrapped the JSON
    if (rawContent.startsWith("```json")) {
      rawContent = rawContent
        .replace(/^```json\n?/, "")
        .replace(/\n?```$/, "");
    }
    sections = JSON.parse(rawContent);
    if (!Array.isArray(sections)) {
      sections = ["Introduction", "Key Findings", "Conclusion"];
    }
  } catch (error) {
    console.error("Failed to parse report plan:", error);
    sections = ["Introduction", "Key Findings", "Conclusion"];
  }

  // Guard: clamp to a maximum of 6 sections per spec
  sections = sections.slice(0, 6);

  // 2. For each section, search and synthesise — in parallel for speed.
  const compiledSections = await Promise.all(
    sections.map(async (section) => {
      const results = await vectorSearch({
        orgId,
        userId,
        user_role: role as "member" | "super_user" | "admin",
        query: `${query} - ${section}`,
        topK: 5,
      });

      // Build a structured source list with chunk_id + document_id for citations.
      const sourceDocs = results.map((r: any, i: number) => ({
        index: i + 1,
        chunk_id: r.chunk_id ?? r.id ?? `chunk_${i}`,
        document_id: r.document_id ?? "unknown",
        content:
          r.content_preview ??
          r.metadata?.text_preview ??
          r.metadata?.content ??
          r.metadata?.text ??
          (typeof r.metadata === "object"
            ? JSON.stringify(r.metadata)
            : String(r.metadata ?? "")),
      }));

      const sourceBlock = sourceDocs
        .map(
          (s: { index: number; chunk_id: string; document_id: string; content: string }) =>
            `[Source ${s.index}] chunk_id=${s.chunk_id}, document_id=${s.document_id}\n${s.content}`
        )
        .join("\n\n");

      // Synthesise with mandatory citation format
      const synthesizePrompt = `You are a helpful analyst writing a section for a report.
Section Title: ${section}

Below are the source documents retrieved for this section. Each source has a chunk_id.

${sourceBlock}

INSTRUCTIONS:
- Write the section content in markdown format.
- Do NOT include the section title as a heading, just write the body content.
- You MUST cite sources inline using the format [source: <chunk_id>] for every claim derived from a source document.
- Every section must contain at least one citation.`;

      const synthesizeResponse = await synthesisModel.invoke([
        new SystemMessage(synthesizePrompt),
        new HumanMessage("Write the section now."),
      ]);

      const sectionContent = extractText(
        synthesizeResponse.content as string | MessageContentComplex[]
      );
      return `## ${section}\n\n${sectionContent}`;
    })
  );

  // Combine into final report
  const finalReport = compiledSections.join("\n\n");

  return {
    final_answer: finalReport,
  };
}
