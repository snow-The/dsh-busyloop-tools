// dsh-busyloop-tools tests: tool registration + key handling + error paths,
// using the same mock-ctx pattern as dsh-plugin-guide. No real API calls here —
// the live E2E lives in e2e/e2e-tools.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { name, apply } from '../dist/index.js';

function makeCtx() {
  const registered = [];
  return { ctx: { tools: { register: (def) => registered.push(def) } }, registered };
}

test('exports name and apply', () => {
  assert.equal(name, 'dsh-busyloop-tools');
  assert.equal(typeof apply, 'function');
});

test('apply registers exactly one tool: busyloop_run', () => {
  const { ctx, registered } = makeCtx();
  apply(ctx);
  const names = registered.map((d) => d.name);
  assert.deepEqual(names, ['busyloop_run']);
});

test('busyloop_run fails cleanly without a key (no API call)', async () => {
  const { ctx, registered } = makeCtx();
  apply(ctx);
  const run = registered.find((d) => d.name === 'busyloop_run');

  const home = await mkdtemp(join(tmpdir(), 'blt-home-'));
  const prevHome = process.env.USERPROFILE;
  const prevArk = process.env.ARK_API_KEY;
  process.env.USERPROFILE = home;
  delete process.env.ARK_API_KEY;
  try {
    const raw = await run.execute({ prompt: 'Say hi' });
    const out = JSON.parse(raw);
    assert.equal(out.ok, false);
    assert.match(out.error, /No ARK_API_KEY found/);
  } finally {
    if (prevHome === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = prevHome;
    if (prevArk === undefined) delete process.env.ARK_API_KEY;
    else process.env.ARK_API_KEY = prevArk;
    await rm(home, { recursive: true, force: true });
  }
});

test('busyloop_run accepts explicit direct channel without a key (error path)', async () => {
  const { ctx, registered } = makeCtx();
  apply(ctx);
  const run = registered.find((d) => d.name === 'busyloop_run');

  const home = await mkdtemp(join(tmpdir(), 'blt-home-'));
  const prevHome = process.env.USERPROFILE;
  const prevDeep = process.env.DEEPSEEK_API_KEY;
  process.env.USERPROFILE = home;
  delete process.env.DEEPSEEK_API_KEY;
  try {
    const raw = await run.execute({ prompt: 'Say hi', channel: 'direct' });
    const out = JSON.parse(raw);
    assert.equal(out.ok, false);
    assert.match(out.error, /No DEEPSEEK_API_KEY found/);
  } finally {
    if (prevHome === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = prevHome;
    if (prevDeep === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = prevDeep;
    await rm(home, { recursive: true, force: true });
  }
});
