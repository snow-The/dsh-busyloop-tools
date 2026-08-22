// src/index.ts
import { readFileSync } from "node:fs";
import { Context } from "@deepseek-ai/cordis";
import LlmRuntime from "@deepseek-ai/dsh-llm";
import { DeepSeekAdapter } from "@deepseek-ai/dsh-llm-deepseek";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { hostLlm, runBusyLoop } from "@snow-the/dsh-busyloop";
import yaml from "js-yaml";
var name = "dsh-busyloop-tools";
var inject = ["tools"];
var CHANNELS = {
  ark: {
    baseURL: "https://ark.cn-beijing.volces.com/api/plan/v3",
    model: "deepseek-v4-flash",
    keyEnv: "ARK_API_KEY"
  },
  direct: {
    baseURL: "https://api.deepseek.com",
    model: "deepseek-chat",
    keyEnv: "DEEPSEEK_API_KEY"
  }
};
function credentialsPath() {
  return `${process.env.USERPROFILE ?? ""}\\.dsh\\.credentials.yaml`;
}
function loadKey(keyEnv) {
  if (process.env[keyEnv]) return process.env[keyEnv];
  try {
    const creds = yaml.load(readFileSync(credentialsPath(), "utf8"));
    return creds?.refs?.[keyEnv]?.value ?? creds?.refs?.[keyEnv] ?? creds?.[keyEnv];
  } catch {
    return void 0;
  }
}
var runtimes = /* @__PURE__ */ new Map();
function getRuntime(channelKey) {
  const channel = CHANNELS[channelKey];
  let built = runtimes.get(channelKey);
  if (!built) {
    const ctx = new Context();
    const runtime = new LlmRuntime(ctx);
    const adapter = new DeepSeekAdapter({
      options: () => ({
        baseURL: channel.baseURL,
        apiKeyEnv: channel.keyEnv,
        defaults: {},
        maxTokens: 2048,
        defaultContextWindow: 65536,
        models: [{ id: channel.model }],
        streamIdleTimeoutMs: 12e4,
        maxRequestFilesBytes: 0,
        maxInlineRequestImageBytes: 0,
        maxImagesPerRequest: 0,
        imageOffloadByteQuantum: 1,
        inlineImageOffloadByteQuantum: 1,
        imageOffloadCountQuantum: 1,
        filesApiTimeoutMs: 1e4
      }),
      resolveApiKey: async () => process.env[channel.keyEnv],
      resolveUserId: () => "dsh-busyloop-tools"
    });
    ctx.llm.registerAdapter(["deepseek"], adapter);
    built = { llm: hostLlm(ctx.llm) };
    runtimes.set(channelKey, built);
  }
  return { llm: built.llm, channel };
}
function apply(ctx) {
  ctx.tools.register(
    defineTool({
      name: "busyloop_run",
      description: "Run one one-off subagent loop on a cheap channel (default: Volcano Ark plan API with deepseek-v4-flash, billed to the ARK key \u2014 main-model tokens untouched). Returns the loop output plus turn/tool-call/usage stats. Use for disposable research, validation, formatting, or any task that does not need the main conversation context.",
      parameters: {
        prompt: {
          type: "string",
          description: "The task prompt for the sub-loop. Self-contained: it runs without access to this conversation.",
          required: true
        },
        channel: {
          type: "string",
          description: "Which LLM channel to use. ark (default) = Volcano Ark plan API, deepseek-v4-flash, ARK_API_KEY; direct = api.deepseek.com, deepseek-chat, DEEPSEEK_API_KEY."
        },
        system: {
          type: "string",
          description: "Optional system prompt for the sub-loop."
        },
        maxTurns: {
          type: "number",
          description: "Max loop turns before forced stop (default 8)."
        },
        maxTokens: {
          type: "number",
          description: "Max output tokens per generation (default 2048)."
        }
      },
      output: {
        schema: { type: "string" },
        render: (_args, value) => [{ type: "text", text: value }]
      },
      async execute(args, exec) {
        const channelKey = args.channel === "direct" ? "direct" : "ark";
        const { llm, channel } = getRuntime(channelKey);
        const key = loadKey(channel.keyEnv);
        if (!key) {
          return JSON.stringify({
            ok: false,
            error: `No ${channel.keyEnv} found (checked env and ${credentialsPath()})`
          });
        }
        process.env[channel.keyEnv] = key;
        try {
          const result = await runBusyLoop(llm, {
            provider: "deepseek",
            model: channel.model,
            prompt: String(args.prompt),
            system: args.system ? String(args.system) : void 0,
            maxTurns: args.maxTurns ? Number(args.maxTurns) : void 0,
            maxTokens: args.maxTokens ? Number(args.maxTokens) : void 0,
            signal: exec?.signal,
            sessionId: "busyloop-tools"
          });
          return JSON.stringify({
            ok: true,
            channel: channelKey,
            model: channel.model,
            output: result.output,
            turns: result.turns,
            toolCalls: result.toolCalls,
            finish: result.finish,
            usage: result.usage ?? null
          });
        } catch (err) {
          return JSON.stringify({
            ok: false,
            channel: channelKey,
            error: err instanceof Error ? err.message : String(err)
          });
        }
      }
    })
  );
}
export {
  apply,
  inject,
  name
};
