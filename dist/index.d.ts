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
export declare const name = "dsh-busyloop-tools";
export declare const inject: string[];
export declare function apply(ctx: any): void;
