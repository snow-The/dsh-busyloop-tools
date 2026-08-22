/**
 * dsh-busyloop-tools — expose the dsh-busyloop engine to the agent as tools.
 *
 * The busyloop engine is a library: mounted or not, the agent sees nothing.
 * This plugin bridges that gap — the agent can dispatch a one-off task to a
 * cheap channel (Volcano Ark plan API by default) and get the loop result
 * back without spending any main-model tokens.
 *
 * Tools:
 *   busyloop_run     — run one one-off subagent loop on a chosen channel.
 *   busyloop_health  — report which channels are usable (key presence).
 *
 * Channels:
 *   ark    (default) https://ark.cn-beijing.volces.com/api/plan/v3
 *                      model deepseek-v4-flash, key ARK_API_KEY
 *   direct            https://api.deepseek.com
 *                      model deepseek-chat,  key DEEPSEEK_API_KEY
 */

import { readFileSync } from 'node:fs';
import { Context } from '@deepseek-ai/cordis';
import LlmRuntime from '@deepseek-ai/dsh-llm';
import { DeepSeekAdapter } from '@deepseek-ai/dsh-llm-deepseek';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { hostLlm, runBusyLoop } from '@snow-the/dsh-busyloop';
import type { HostLlm, LoopTool } from '@snow-the/dsh-busyloop';
import yaml from 'js-yaml';

export const name = 'dsh-busyloop-tools';
export const inject = ['tools'];

interface Channel {
  baseURL: string;
  model: string;
  keyEnv: string;
}

const CHANNELS: Record<'ark' | 'direct', Channel> = {
  ark: {
    baseURL: 'https://ark.cn-beijing.volces.com/api/plan/v3',
    model: 'deepseek-v4-flash',
    keyEnv: 'ARK_API_KEY',
  },
  direct: {
    baseURL: 'https://api.deepseek.com',
    model: 'deepseek-chat',
    keyEnv: 'DEEPSEEK_API_KEY',
  },
};

function credentialsPath(): string {
  return `${process.env.USERPROFILE ?? ''}\\.dsh\\.credentials.yaml`;
}

function loadKey(keyEnv: string): string | undefined {
  // Env wins (test/debug override), then ~/.dsh/.credentials.yaml.
  if (process.env[keyEnv]) return process.env[keyEnv];
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const creds: any = yaml.load(readFileSync(credentialsPath(), 'utf8'));
    return creds?.refs?.[keyEnv]?.value ?? creds?.refs?.[keyEnv] ?? creds?.[keyEnv];
  } catch {
    return undefined;
  }
}

// One shared runtime per channel, built on first use.
const runtimes = new Map<'ark' | 'direct', { llm: HostLlm }>();

function getRuntime(channelKey: keyof typeof CHANNELS): { llm: HostLlm; channel: Channel } {
  const channel = CHANNELS[channelKey];
  let built = runtimes.get(channelKey);
  if (!built) {
    const ctx = new Context();
    const runtime = new LlmRuntime(ctx);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const adapter = new DeepSeekAdapter({
      options: () => ({
        baseURL: channel.baseURL,
        apiKeyEnv: channel.keyEnv,
        defaults: {},
        maxTokens: 2048,
        defaultContextWindow: 65536,
        models: [{ id: channel.model }],
        streamIdleTimeoutMs: 120000,
        maxRequestFilesBytes: 0,
        maxInlineRequestImageBytes: 0,
        maxImagesPerRequest: 0,
        imageOffloadByteQuantum: 1,
        inlineImageOffloadByteQuantum: 1,
        imageOffloadCountQuantum: 1,
        filesApiTimeoutMs: 10000,
      }),
      resolveApiKey: async () => process.env[channel.keyEnv],
      resolveUserId: () => 'dsh-busyloop-tools',
    } as never);
    ctx.llm.registerAdapter(['deepseek'], adapter);
    built = { llm: hostLlm(ctx.llm) };
    runtimes.set(channelKey, built);
  }
  return { llm: built.llm, channel };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function apply(ctx: any): void {
  ctx.tools.register(
    defineTool({
      name: 'busyloop_run',
      description:
        'Run one one-off subagent loop on a cheap channel (default: Volcano Ark plan API with deepseek-v4-flash, billed to the ARK key — main-model tokens untouched). Returns the loop output plus turn/tool-call/usage stats. Use for disposable research, validation, formatting, or any task that does not need the main conversation context.',
      parameters: {
        prompt: {
          type: 'string',
          description: 'The task prompt for the sub-loop. Self-contained: it runs without access to this conversation.',
          required: true,
        },
        channel: {
          type: 'string',
          description: 'Which LLM channel to use. ark (default) = Volcano Ark plan API, deepseek-v4-flash, ARK_API_KEY; direct = api.deepseek.com, deepseek-chat, DEEPSEEK_API_KEY.',
        },
        system: {
          type: 'string',
          description: 'Optional system prompt for the sub-loop.',
        },
        maxTurns: {
          type: 'number',
          description: 'Max loop turns before forced stop (default 8).',
        },
        maxTokens: {
          type: 'number',
          description: 'Max output tokens per generation (default 2048).',
        },
      },
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: value }],
      },
      async execute(args, exec) {
        const channelKey: 'ark' | 'direct' = args.channel === 'direct' ? 'direct' : 'ark';
        const { llm, channel } = getRuntime(channelKey);
        const key = loadKey(channel.keyEnv);
        if (!key) {
          return JSON.stringify({
            ok: false,
            error: `No ${channel.keyEnv} found (checked env and ${credentialsPath()})`,
          });
        }
        process.env[channel.keyEnv] = key;

        try {
          const result = await runBusyLoop(llm, {
            provider: 'deepseek',
            model: channel.model,
            prompt: String(args.prompt),
            system: args.system ? String(args.system) : undefined,
            maxTurns: args.maxTurns ? Number(args.maxTurns) : undefined,
            maxTokens: args.maxTokens ? Number(args.maxTokens) : undefined,
            signal: exec?.signal,
            sessionId: 'busyloop-tools',
          });
          return JSON.stringify({
            ok: true,
            channel: channelKey,
            model: channel.model,
            output: result.output,
            turns: result.turns,
            toolCalls: result.toolCalls,
            finish: result.finish,
            usage: result.usage ?? null,
          });
        } catch (err) {
          return JSON.stringify({
            ok: false,
            channel: channelKey,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      },
    }),
  );

  ctx.tools.register(
    defineTool({
      name: 'busyloop_health',
      description:
        'Report which busyloop channels are usable: whether ARK_API_KEY / DEEPSEEK_API_KEY are present in the environment or ~/.dsh/.credentials.yaml, and the endpoint/model each channel uses.',
      parameters: {},
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: value }],
      },
      async execute() {
        const rows = Object.entries(CHANNELS).map(([key, ch]) => {
          const present = Boolean(loadKey(ch.keyEnv));
          return { channel: key, baseURL: ch.baseURL, model: ch.model, keyEnv: ch.keyEnv, keyPresent: present };
        });
        return JSON.stringify({ ok: true, channels: rows });
      },
    }),
  );
}
