# Athene Synthesis Agent

The Synthesis Agent is the final "writer" in the multi-agent pipeline. It takes raw retrieval results (context chunks) and synthesizes them into a human-readable, cited answer.

## Key Features

- **Inline Citations**: Every claim is backed by a document ID in the format `[doc_id]`.
- **Dual Modes**:
  - **Standard**: Optimized for direct, helpful answers to general queries.
  - **BI (Business Intelligence)**: Triggered for analytical or cross-departmental queries. Emphasizes structured analysis, metrics, and highlighting data gaps.
- **Hallucination Prevention**: Strictly adheres to the "Source Adherence" principal. If no relevant info is found in `retrieved_chunks`, it returns a standard refusal message.
- **Streaming**: Integrated with LangChain Chat Models to support real-time token streaming via LangGraph's `streamEvents`.

## State Contract

- **Input**:
  - `state.retrieved_chunks`: List of raw content chunks provided by retrieval agents.
  - `state.messages`: Conversation history.
  - `state.task_type` / `state.is_cross_dept_query`: Used to toggle analytical mode.
- **Output**:
  - `state.final_answer`: The synthesized Markdown response.
  - `state.cited_sources`: Metadata for all documents referenced in the final answer.
  - **Cleanup**: `state.retrieved_chunks` is cleared (set to `[]`) at the end of the node's execution to ensure fresh context for future turns within the same thread.

## Development & Testing

The prompt is maintained in `lib/agents/prompts/synthesis.md` to allow for easy iteration without code changes.

### Running Tests

```bash
npx vitest lib/agents/__tests__/synthesis-agent.test.ts
```

The test suite covers:
1. Happy path (Standard synthesis + Citation extraction).
2. Missing info handling (Empty chunks).
3. BI mode activation.
4. Multiple citation support.
5. Hallucination guardrails.
