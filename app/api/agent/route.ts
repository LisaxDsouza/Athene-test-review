import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { HumanMessage } from "@langchain/core/messages";
import { getAgentGraph } from "@/lib/langgraph/graph";
import { mapRole } from "@/lib/auth/clerk";
import { resolveOrgUuid } from "@/lib/auth/rbac";

export const maxDuration = 300; // Vercel max for Pro plan

export async function POST(req: NextRequest) {
  try {
    const { userId, orgId, orgRole } = await auth();

    if (!userId || !orgId) {
      return new NextResponse("Unauthorized", { status: 401 });
    }

    const orgUuid = await resolveOrgUuid(orgId);
    if (!orgUuid) {
      return new NextResponse("Organization not found", { status: 403 });
    }

    const { message, threadId } = await req.json();

    const role = mapRole(orgRole ?? undefined) ?? "member";

    const initialState = {
      messages: [new HumanMessage(message)],
      org_id: orgUuid,
      user_id: userId,
      user_role: role,
    };

    const graph = await getAgentGraph();
    const encoder = new TextEncoder();
    const stream = new TransformStream();
    const writer = stream.writable.getWriter();

    (async () => {
      try {
        const eventStream = await graph.stream(initialState, {
          configurable: {
            thread_id: threadId || `user-${userId}`,
            org_id: orgUuid,
            user_id: userId,
          },
          streamMode: "values",
        });

        for await (const chunk of eventStream as AsyncIterable<any>) {
          const lastMessage = chunk.messages?.[chunk.messages.length - 1];
          if (lastMessage) {
            const data = JSON.stringify({
              content: lastMessage.content,
              final_answer: chunk.final_answer ?? null,
              cited_sources: chunk.cited_sources ?? [],
              awaiting_approval: chunk.awaiting_approval ?? false,
              active_agent: chunk.next ?? null,
            });
            await writer.write(encoder.encode(`data: ${data}\n\n`));
          }
        }
        await writer.close();
      } catch (err: unknown) {
        console.error("[agent] Stream error:", err);
        await writer.abort(err);
      }
    })();

    return new Response(stream.readable, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Internal Server Error";
    console.error("[agent] API error:", msg);
    return new NextResponse(msg, { status: 500 });
  }
}
