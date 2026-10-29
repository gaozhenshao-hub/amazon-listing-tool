import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { assertIsolatedNetwork, assertPng, bounded, inspectDependencies, inspectBrowser, validateProbe, inspectAudio } from './verify-qingdao-media-runtime.mjs';

const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.alloc(40)]);
const probe = Buffer.from(JSON.stringify({ streams: [{ codec_name: 'flac', sample_rate: '16000', channels: 1 }] }));

test('network isolation refuses a host NIC or an unparseable namespace', () => {
  assertIsolatedNetwork('Inter-| Receive\n face |bytes\n lo: 0 0 0 0');
  for (const text of ['', 'eth0: 123', 'lo: 0\n eth0: 0', 'lo: 0\n veth0: 0']) assert.throws(() => assertIsolatedNetwork(text), /NETWORK_ISOLATION_REQUIRED/);
});

test('dependencies load driver/query-builder only and exercise a native sharp roundtrip', async () => {
  const loaded = [];
  const forbidden = () => { throw new Error('database connection attempted'); };
  const sharp = input => {
    if (Buffer.isBuffer(input)) return { metadata: async () => ({ width: 2, height: 2, format: 'png' }) };
    assert.deepEqual(input.create, { width: 2, height: 2, channels: 4, background: { r: 20, g: 80, b: 140, alpha: 1 } });
    return { png: () => ({ toBuffer: async () => png }) };
  };
  sharp.versions = { sharp: 'test', vips: 'test' };
  const modules = { 'mysql2/promise': { createConnection: forbidden, createPool: forbidden }, 'drizzle-orm': { sql: forbidden }, 'drizzle-orm/mysql2': { drizzle: forbidden }, sharp };
  const result = await inspectDependencies(name => { loaded.push(name); return modules[name]; });
  assert.deepEqual(loaded, Object.keys(modules));
  assert.equal(result.sharpNativeRoundtrip, true);
  assert.equal(result.mysql2Loaded, true);
  await assert.rejects(inspectDependencies(() => ({})), /DATABASE_DEPENDENCY_EXPORTS_INVALID/);
});

function browserFixture({ failContent = false, version = '151.0.7922.34' } = {}) {
  const calls = [];
  const browser = {
    version: () => version,
    close: async () => { calls.push('close'); },
    newContext: async options => {
      assert.deepEqual(options, { offline: true, serviceWorkers: 'block', viewport: { width: 320, height: 180 } });
      return {
        route: async (pattern, handler) => { assert.equal(pattern, '**/*'); await handler({ abort: async () => calls.push('route_abort') }); },
        newPage: async () => ({
          setDefaultTimeout: value => assert.equal(value, 5000),
          setDefaultNavigationTimeout: value => assert.equal(value, 5000),
          setContent: async html => { assert.doesNotMatch(html, /https?:\/\//); if (failContent) throw new Error('private error'); calls.push('content'); },
          title: async () => 'Offline media smoke',
          locator: name => { assert.equal(name, 'h1'); return { textContent: async () => 'Qingdao offline smoke' }; },
          screenshot: async options => { assert.equal(options.path, undefined); return png; },
        }),
      };
    },
  };
  const chromium = { launch: async options => {
    assert.equal(options.executablePath, '/browser/chrome');
    assert.equal(options.timeout, 15000);
    assert.equal(options.headless, true);
    assert.equal(options.env.HOME, '/private/temp');
    assert.equal(options.env.DATABASE_URL, undefined);
    assert.deepEqual(Object.keys(options.env).sort(), ['HOME', 'LANG', 'LC_ALL', 'PATH', 'TMPDIR', 'XDG_CACHE_HOME', 'XDG_CONFIG_HOME']);
    return browser;
  } };
  return { chromium, calls };
}

test('browser launch uses the exact binary, offline memory content, no inherited secrets, and closes', async () => {
  const fixture = browserFixture();
  const result = await inspectBrowser(fixture.chromium, '/browser/chrome', '/private/temp', '151.0.7922.34');
  assert.equal(result.screenshotPng, true);
  assert.deepEqual(fixture.calls, ['route_abort', 'content', 'close']);
});

test('browser is closed even when content verification or browser-version validation fails', async () => {
  for (const options of [{ failContent: true }, { version: 'wrong' }]) {
    const fixture = browserFixture(options);
    await assert.rejects(inspectBrowser(fixture.chromium, '/browser/chrome', '/private/temp', '151.0.7922.34'));
    assert.equal(fixture.calls.at(-1), 'close');
  }
});

test('audio uses only in-memory pipes and confirms codec/rate/channels plus actual duration', () => {
  const calls = [];
  const flac = Buffer.from('fLaCsynthetic-test');
  const result = inspectAudio((binary, args, input) => {
    calls.push({ binary, args });
    if (calls.length === 1) {
      assert.equal(binary, '/usr/bin/ffmpeg');
      assert.ok(args.includes('anullsrc=r=16000:cl=mono'));
      assert.equal(args[args.indexOf('-t') + 1], '1');
      assert.equal(args.at(-1), 'pipe:1');
      assert.equal(input, undefined);
      return flac;
    }
    assert.equal(input, flac);
    assert.equal(args[args.indexOf('-protocol_whitelist') + 1], 'pipe');
    if (binary === '/usr/bin/ffprobe') return probe;
    assert.equal(args.at(-1), 'pipe:1');
    return Buffer.alloc(32000);
  });
  assert.equal(calls.length, 3);
  assert.deepEqual(result, { codec: 'flac', sampleRate: 16000, channels: 1, sampleCount: 16000, durationSeconds: 1, flacBytes: flac.length, pcmBytes: 32000 });
});

test('invalid codec, rate, channels, FLAC, duration and PNG cannot pass', () => {
  for (const streams of [[], [{ codec_name: 'mp3', sample_rate: '16000', channels: 1 }], [{ codec_name: 'flac', sample_rate: '48000', channels: 1 }], [{ codec_name: 'flac', sample_rate: '16000', channels: 2 }]]) assert.throws(() => validateProbe(Buffer.from(JSON.stringify({ streams }))), /FFPROBE_AUDIO_MISMATCH/);
  assert.throws(() => validateProbe(Buffer.from('secret non-json')), /FFPROBE_JSON_INVALID/);
  assert.throws(() => inspectAudio(() => Buffer.from('bad')), /FFMPEG_FLAC_INVALID/);
  let count = 0;
  assert.throws(() => inspectAudio(() => ++count === 1 ? Buffer.from('fLaCtest') : count === 2 ? probe : Buffer.alloc(16)), /FFMPEG_SAMPLE_COUNT_MISMATCH/);
  assert.throws(() => assertPng(Buffer.from('not png')), /PNG_VALIDATION_FAILED/);
  assertPng(png);
});

test('bounded operations time out without returning a false success', async () => {
  assert.equal(await bounded(Promise.resolve('ok'), 100, 'FAILED'), 'ok');
  await assert.rejects(bounded(new Promise(() => {}), 5, 'EXPECTED_TIMEOUT'), /EXPECTED_TIMEOUT/);
});

test('standalone script has no app imports, config/environment reads or database connections', () => {
  const source = fs.readFileSync(new URL('./verify-qingdao-media-runtime.mjs', import.meta.url), 'utf8');
  const imports = [...source.matchAll(/^import .*? from '([^']+)'/gm)].map(match => match[1]);
  assert.ok(imports.length > 0 && imports.every(value => value.startsWith('node:')));
  assert.doesNotMatch(source, /process\.env|dotenv|\.createConnection\(|\.createPool\(|\.connect\(|page\.goto\(/);
  assert.doesNotMatch(source, /readFileSync\([^\n]*(?:runtime\.conf|\.env)/);
  assert.match(source, /timeout: 8000, killSignal: 'SIGKILL'/);
  assert.match(source, /55000/);
  assert.match(source, /\(\) => process.exit\(1\)/);
  assert.match(source, /if \(passed\) clearTimeout\(deadline\)/);
});
