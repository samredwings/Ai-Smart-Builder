import { createFileRoute } from "@tanstack/react-router";
import { convertToModelMessages, type UIMessage } from "ai";
import { createResponsesCall } from "@/lib/ai/responses.server";
import { bearerFrom, verifyBearer } from "@/lib/workspace/auth.server";

const SYSTEM = `You are a helpful personal workspace assistant.
The user may attach files (including the contents of unpacked .zip archives) and web pages; these appear inside the user's message between <attachment> or <webpage> tags.
Use them to answer precisely: summarize, explain code, find bugs, and reference file paths when relevant.
Be concise and use Markdown.`;

export const Route = createFileRoute("/api/workspace-chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const userId = await verifyBearer(bearerFrom(request));
        if (!userId) return Response.json({ error: "Please sign in again." }, { status: 401 });
        const apiKey = process.env.LOVABLE_API_KEY;
        if (!apiKey) return Response.json({ error: "AI is not configured." }, { status: 500 });

        let body: { messages?: UIMessage[] };
        try {
          body = await request.json();
        } catch {
          return Response.json({ error: "Bad request" }, { status: 400 });
        }
        const messages = (body.messages ?? []).slice(-30);
        if (!messages.length) return Response.json({ error: "No messages" }, { status: 400 });

        const { response } = createResponsesCall(
          request,
          { baseURL: "https://ai.gateway.lovable.dev/v1", apiKey, model: "openai/gpt-6-astra" },
          await convertToModelMessages(messages),
          SYSTEM,
        );
        return response();
      },
    },
  },
});
