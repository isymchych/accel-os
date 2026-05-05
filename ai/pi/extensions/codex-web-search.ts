import { AuthStorage, type ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";

import {
  buildCodexWebSearchBody,
  parseCodexResponsesStream,
  resolveCodexWebSearchModel,
} from "../lib/codex-web-search.ts";
import {
  parseOpenAICodexCredential,
  readOpenAICodexAccountProfile,
} from "../lib/openai-codex-auth.ts";

const PROVIDER_ID = "openai-codex";
const CODEX_RESPONSES_URL = "https://chatgpt.com/backend-api/codex/responses";

const codexWebSearchParameters = Type.Object({
  query: Type.String({
    description: "Search query to send to the OpenAI Codex web search backend.",
  }),
  mode: Type.Optional(
    Type.Union([Type.Literal("live"), Type.Literal("cached")], {
      description: "Whether Codex should use live web access or cached search results.",
    }),
  ),
  allowed_domains: Type.Optional(
    Type.Array(Type.String({ description: "Domain hostname to allow, for example example.com." }), {
      description: "Optional list of domains to restrict search results to.",
    }),
  ),
  context_size: Type.Optional(
    Type.Union([Type.Literal("low"), Type.Literal("medium"), Type.Literal("high")], {
      description: "How much search context Codex should retrieve.",
    }),
  ),
});

interface CodexCredential {
  accessToken: string;
  accountId: string;
}

async function getCodexCredential(authStorage: AuthStorage): Promise<CodexCredential> {
  authStorage.reload();
  const savedCredential = parseOpenAICodexCredential(authStorage.get(PROVIDER_ID));
  if (savedCredential === null) {
    throw new Error("Not logged into OpenAI Codex. Run /login and choose OpenAI Codex.");
  }

  const accessToken = await authStorage.getApiKey(PROVIDER_ID);
  if (accessToken === undefined || accessToken.length === 0) {
    throw new Error("OpenAI Codex access token is missing. Run /login and choose OpenAI Codex.");
  }

  authStorage.reload();
  const refreshedCredential = parseOpenAICodexCredential(authStorage.get(PROVIDER_ID));
  const profile = readOpenAICodexAccountProfile(accessToken);
  const accountId = refreshedCredential?.accountId ?? profile.accountId;
  if (accountId === undefined || accountId.length === 0) {
    throw new Error("OpenAI Codex credential is missing ChatGPT account id.");
  }

  return {
    accessToken,
    accountId,
  };
}

async function readErrorResponse(response: Response): Promise<string> {
  const details = await response.text().catch(() => "");
  const normalized = details.replace(/\s+/g, " ").trim();
  return normalized.length > 0 ? ` ${normalized}` : "";
}

export default function codexWebSearchExtension(pi: ExtensionAPI): void {
  const authStorage = AuthStorage.create();

  pi.registerTool({
    name: "codex_web_search",
    label: "Codex Web Search",
    description:
      "Search the web using OpenAI Codex native web search via the ChatGPT Codex backend.",
    promptSnippet:
      "Search the web via the OpenAI Codex native web search backend for current information",
    promptGuidelines: [
      "Use codex_web_search when the user asks for current or external web information.",
    ],
    parameters: codexWebSearchParameters,
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      const query = params.query.trim();
      if (query.length === 0) {
        throw new Error("query must not be empty");
      }

      const credential = await getCodexCredential(authStorage);
      const modelId = resolveCodexWebSearchModel(ctx.model);
      const mode = params.mode ?? "live";
      const body = buildCodexWebSearchBody({
        model: modelId,
        query,
        mode,
        ...(params.allowed_domains === undefined
          ? {}
          : { allowed_domains: params.allowed_domains }),
        ...(params.context_size === undefined ? {} : { context_size: params.context_size }),
      });

      const response = await fetch(CODEX_RESPONSES_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${credential.accessToken}`,
          "OpenAI-Beta": "responses=experimental",
          accept: "text/event-stream",
          "chatgpt-account-id": credential.accountId,
          "content-type": "application/json",
          originator: "pi",
          "User-Agent": "pi-codex-web-search",
        },
        body: JSON.stringify(body),
        ...(signal === undefined ? {} : { signal }),
      });

      if (!response.ok) {
        const details = await readErrorResponse(response);
        throw new Error(
          `Codex web search request failed (${response.status} ${response.statusText}).${details}`,
        );
      }

      if (response.body === null) {
        throw new Error("Codex web search response did not include a body.");
      }

      const result = await parseCodexResponsesStream(response.body, {
        onTextDelta: (text) => {
          onUpdate?.({
            content: [{ type: "text", text }],
            details: {
              mode,
              model: modelId,
              query,
            },
          });
        },
      });

      return {
        content: [{ type: "text", text: result.text }],
        details: {
          mode,
          model: modelId,
          query,
          responseId: result.responseId,
        },
      };
    },
  });
}
