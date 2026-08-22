/**
 * 真机 E2E 冒烟(需要真实 ARK_API_KEY,在 ~/.dsh/.credentials.yaml 或 env):
 *   模拟宿主 apply + 直接调用 busyloop_run 工具,走真实 ark plan API。
 * 运行: node e2e/e2e-tools.mjs
 * 密钥注入方式与插件运行时一致(env → credentials.yaml),不打印。
 */
import { name, apply } from '../dist/index.js';

const registered = [];
apply({ tools: { register: (def) => registered.push(def) } });

const health = registered.find((d) => d.name === 'busyloop_health');
const run = registered.find((d) => d.name === 'busyloop_run');

const h = JSON.parse(await health.execute({}));
console.log('HEALTH:', JSON.stringify(h));
const ark = h.channels.find((c) => c.channel === 'ark');
if (!ark.keyPresent) {
  console.error('NO ARK KEY — cannot run live E2E');
  process.exit(1);
}

const out = JSON.parse(
  await run.execute({
    prompt: 'Answer in one short sentence: what is 2+2?',
    channel: 'ark',
    maxTokens: 200,
  }),
);
console.log('RUN:', JSON.stringify(out));
if (!out.ok || !out.output || out.turns < 1) {
  console.error('E2E FAILED:', out.error ?? 'empty result');
  process.exit(1);
}
console.log('E2E OK');
