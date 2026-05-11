import OpenAI from "openai";

let openai: OpenAI | null = null;

function getOpenAI() {
  if (!openai) {
    openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY!,
    });
  }
  return openai;
}

/**
 * Generates an embedding for the given text using OpenAI.
 * Model: text-embedding-3-small (1536 dimensions)
 */
export async function embed(text: string, apiKey?: string): Promise<number[]> {
  const finalKey = apiKey || process.env.OPENAI_API_KEY;
  
  if (!finalKey) {
    throw new Error("OpenAI API key is not defined (checked BYOK and platform env)");
  }

  const client = new OpenAI({ apiKey: finalKey });
  const res = await client.embeddings.create({
    model: "text-embedding-3-small",
    input: text,
  });

  return res.data[0].embedding;
}
