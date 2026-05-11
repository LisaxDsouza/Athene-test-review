import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { HumanMessage } from '@langchain/core/messages'
import { getAgentGraph } from '@/lib/langgraph/graph'

export async function POST(req: NextRequest) {
  const { userId, orgId } = await auth()
  if (!userId || !orgId) return new NextResponse('Unauthorized', { status: 401 })

  let body: { threadId?: string; userInput?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { threadId, userInput } = body
  if (!threadId) {
    return NextResponse.json({ error: 'threadId is required' }, { status: 400 })
  }

  const graph = await getAgentGraph()

  // Verify the thread exists and belongs to this org
  const snapshot = await graph.getState({ configurable: { thread_id: threadId } })
  const state = snapshot?.values as Record<string, any> | undefined

  if (!state?.org_id) {
    return NextResponse.json({ error: 'Thread not found' }, { status: 404 })
  }
  if (state.org_id !== orgId) {
    return new NextResponse('Forbidden', { status: 403 })
  }
  if (state.user_id !== userId) {
    return new NextResponse('Forbidden', { status: 403 })
  }
  if (state.run_status !== 'awaiting_approval') {
    return NextResponse.json({ error: 'Thread is not awaiting approval' }, { status: 409 })
  }

  // If user provided additional input, append it to state before resuming
  if (userInput) {
    await graph.updateState(
      { configurable: { thread_id: threadId } },
      { messages: [new HumanMessage(userInput)], run_status: 'running' }
    )
  } else {
    await graph.updateState(
      { configurable: { thread_id: threadId } },
      { run_status: 'running' }
    )
  }

  const encoder = new TextEncoder()
  const stream = new TransformStream()
  const writer = stream.writable.getWriter()

    ; (async () => {
      try {
        const eventStream = await graph.stream(null, {
          configurable: { thread_id: threadId },
          streamMode: 'values',
        })

        for await (const chunk of eventStream as AsyncIterable<any>) {
          const lastMessage = chunk.messages?.[chunk.messages.length - 1]
          if (lastMessage) {
            const data = JSON.stringify({ content: lastMessage.content, run_status: chunk.run_status })
            await writer.write(encoder.encode(`data: ${data}\n\n`))
          }
        }
        await writer.close()
      } catch (err) {
        await writer.abort(err)
      }
    })()

  return new Response(stream.readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  })
}
