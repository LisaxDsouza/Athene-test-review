import { createInitialState, runAtheneGraph } from "@/lib/langgraph/graph";
import { requireIdentity } from "@/lib/api/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function sse(event: unknown) {
  return `data: ${JSON.stringify(event)}\n\n`;
}

export async function POST(req: Request) {
  console.log("[api/agent] POST received");
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        console.log("[api/agent] Verifying identity...");
        const { identity, access } = await requireIdentity(req);
        console.log("[api/agent] Identity verified:", identity.userId);

        const body = await req.json();
        const prompt = String(body.prompt || body.message || "").trim();
        if (!prompt) throw new Error("Prompt is required");
        console.log("[api/agent] Prompt:", prompt);

        const VALID_MODES = new Set(["chat", "analytical", "report", "planning", "cross_dept_bi"]);
        const rawMode = String(body.mode || "chat");
        const mode = VALID_MODES.has(rawMode)
          ? (rawMode as import("@/lib/langgraph/state").ResponseMode)
          : ("chat" as const);

        const state = createInitialState({
          prompt,
          threadId: body.thread_id,
          identity,
          access,
          mode,
        });

        console.log("[api/agent] Starting graph...");
        let chunkCount = 0;
        let lastFinalAnswer = "";

        for await (const chunk of runAtheneGraph(state)) {
          chunkCount++;
          console.log(`[api/agent] Chunk #${chunkCount} — active_agent:`, chunk.active_agent, "has final_answer:", !!chunk.final_answer);

          if (
            chunk.final_answer &&
            typeof chunk.final_answer === "string" &&
            chunk.final_answer !== lastFinalAnswer
          ) {
            const newText = chunk.final_answer.slice(lastFinalAnswer.length);
            for (const word of newText.split(" ")) {
              controller.enqueue(
                encoder.encode(sse({ type: "token", content: word + " " }))
              );
            }
            lastFinalAnswer = chunk.final_answer;
          }

          if (chunk.active_agent) {
            controller.enqueue(
              encoder.encode(sse({ type: "agent", content: chunk.active_agent }))
            );
          }
        }

        console.log("[api/agent] Graph finished. Total chunks:", chunkCount);
        controller.enqueue(encoder.encode(sse({ type: "done" })));

      } catch (error) {
        console.error("[api/agent] ERROR:", error instanceof Error ? error.message : error);
        controller.enqueue(
          encoder.encode(
            sse({
              type: "error",
              message: error instanceof Error ? error.message : "Unexpected error",
            })
          )
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}