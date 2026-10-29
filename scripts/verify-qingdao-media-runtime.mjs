import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

// Run under `unshare --net -- node SCRIPT APPDIR BROWSER_EXECUTABLE`.
// For the service-user check, root creates the namespace before runuser.
// No application imports, runtime.conf/.env reads, DB clients, URLs or models.
const fail = code => Object.assign(new Error(code), { safeCode: code });
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const CHILD_ENV = Object.freeze({ PATH: '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C' });

export function assertIsolatedNetwork(procNetDev) {
  const names = procNetDev.split('\n').filter(line => line.includes(':')).map(line => line.slice(0, line.indexOf(':')).trim());
  if (names.length !== 1 || names[0] !== 'lo') throw fail('NETWORK_ISOLATION_REQUIRED');
}
export function assertPng(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length <= 24 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) throw fail('PNG_VALIDATION_FAILED');
}
export async function bounded(promise, milliseconds, code) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(fail(code)), milliseconds); })]);
  } finally { clearTimeout(timer); }
}

export async function inspectDependencies(requireApp) {
  // Loading the driver and query builder is sufficient; never construct a
  // connection or pool, or instantiate an application-owned DB wrapper.
  const mysql = requireApp('mysql2/promise');
  const orm = requireApp('drizzle-orm');
  const mysqlDialect = requireApp('drizzle-orm/mysql2');
  if (typeof mysql.createConnection !== 'function' || typeof mysql.createPool !== 'function' || typeof orm.sql !== 'function' || typeof mysqlDialect.drizzle !== 'function') throw fail('DATABASE_DEPENDENCY_EXPORTS_INVALID');
  const sharp = requireApp('sharp');
  const png = await bounded(sharp({ create: { width: 2, height: 2, channels: 4, background: { r: 20, g: 80, b: 140, alpha: 1 } } }).png().toBuffer(), 5000, 'SHARP_ENCODE_TIMEOUT');
  assertPng(png);
  const metadata = await bounded(sharp(png).metadata(), 5000, 'SHARP_DECODE_TIMEOUT');
  if (metadata.width !== 2 || metadata.height !== 2 || metadata.format !== 'png') throw fail('SHARP_NATIVE_ROUNDTRIP_FAILED');
  return { mysql2Loaded: true, drizzleLoaded: true, drizzleMysql2Loaded: true, sharpNativeRoundtrip: true, sharpVersion: sharp.versions.sharp, libvipsVersion: sharp.versions.vips };
}

export async function inspectBrowser(chromium, executablePath, temporaryHome, expectedVersion) {
  let browser;
  try {
    // Launch deadline also belongs to Playwright so a launch failure cleans up
    // its own partially started process/profile. No default browser lookup.
    browser = await chromium.launch({
      executablePath, headless: true, timeout: 15000,
      args: ['--disable-dev-shm-usage', '--disable-background-networking', '--disable-component-update'],
      env: { ...CHILD_ENV, HOME: temporaryHome, TMPDIR: temporaryHome, XDG_CONFIG_HOME: temporaryHome, XDG_CACHE_HOME: temporaryHome },
    });
    const version = browser.version();
    if (version !== expectedVersion) throw fail('CHROMIUM_VERSION_MISMATCH');
    const result = await bounded((async () => {
      const context = await browser.newContext({ offline: true, serviceWorkers: 'block', viewport: { width: 320, height: 180 } });
      await context.route('**/*', route => route.abort());
      const page = await context.newPage();
      page.setDefaultTimeout(5000);
      page.setDefaultNavigationTimeout(5000);
      await page.setContent('<!doctype html><meta charset="utf-8"><title>Offline media smoke</title><h1>Qingdao offline smoke</h1><style>body{background:#f0f4f8;color:#123;font-family:sans-serif}</style>', { timeout: 5000, waitUntil: 'load' });
      if (await page.title() !== 'Offline media smoke' || await page.locator('h1').textContent() !== 'Qingdao offline smoke') throw fail('CHROMIUM_CONTENT_FAILED');
      const png = await page.screenshot({ type: 'png', timeout: 5000 });
      assertPng(png);
      return { version, offlineContent: true, screenshotPng: true, screenshotBytes: png.length };
    })(), 12000, 'CHROMIUM_CONTENT_TIMEOUT');
    return result;
  } finally {
    if (browser) await bounded(browser.close(), 5000, 'CHROMIUM_CLOSE_TIMEOUT');
  }
}

export function validateProbe(bytes) {
  let probe;
  try { probe = JSON.parse(bytes.toString('utf8')); } catch { throw fail('FFPROBE_JSON_INVALID'); }
  const stream = probe.streams?.length === 1 ? probe.streams[0] : undefined;
  if (stream?.codec_name !== 'flac' || String(stream.sample_rate) !== '16000' || stream.channels !== 1) throw fail('FFPROBE_AUDIO_MISMATCH');
  return { codec: 'flac', sampleRate: 16000, channels: 1 };
}
function mediaCommand(binary, args, input) {
  try {
    return execFileSync(binary, args, {
      input, timeout: 8000, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024,
      stdio: ['pipe', 'pipe', 'ignore'], env: CHILD_ENV,
    });
  } catch { throw fail('MEDIA_COMMAND_FAILED_OR_TIMED_OUT'); }
}
export function inspectAudio(run = mediaCommand) {
  const flac = run('/usr/bin/ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', '-f', 'lavfi', '-i', 'anullsrc=r=16000:cl=mono', '-t', '1', '-c:a', 'flac', '-f', 'flac', 'pipe:1']);
  if (!Buffer.isBuffer(flac) || flac.length < 4 || flac.subarray(0, 4).toString('ascii') !== 'fLaC') throw fail('FFMPEG_FLAC_INVALID');
  const result = validateProbe(run('/usr/bin/ffprobe', ['-v', 'error', '-protocol_whitelist', 'pipe', '-select_streams', 'a:0', '-show_entries', 'stream=codec_name,sample_rate,channels', '-of', 'json', 'pipe:0'], flac));
  // A pipe-encoded FLAC does not necessarily contain a seekable duration header.
  // Decode it to mono 16-bit PCM and verify the actual one-second sample count.
  const pcm = run('/usr/bin/ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', '-protocol_whitelist', 'pipe', '-i', 'pipe:0', '-f', 's16le', '-c:a', 'pcm_s16le', 'pipe:1'], flac);
  if (!Buffer.isBuffer(pcm) || pcm.length !== 32000) throw fail('FFMPEG_SAMPLE_COUNT_MISMATCH');
  return { ...result, sampleCount: 16000, durationSeconds: 1, flacBytes: flac.length, pcmBytes: pcm.length };
}

export async function verifyMedia(appDirectory, browserExecutable) {
  if (process.platform !== 'linux' || process.arch !== 'x64' || process.versions.node.split('.')[0] !== '22') throw fail('LINUX_X64_NODE22_REQUIRED');
  for (const value of [appDirectory, browserExecutable]) if (!value || !path.isAbsolute(value) || path.normalize(value) !== value) throw fail('ABSOLUTE_NORMALIZED_PATHS_REQUIRED');
  if (!fs.statSync(appDirectory).isDirectory() || !fs.statSync(browserExecutable).isFile()) throw fail('RUNTIME_PATH_INVALID');
  fs.accessSync(browserExecutable, fs.constants.X_OK);
  assertIsolatedNetwork(fs.readFileSync('/proc/net/dev', 'utf8'));
  const requireApp = createRequire(path.join(appDirectory, 'package.json'));
  const playwrightPackage = requireApp('playwright-core/package.json');
  if (playwrightPackage.version !== '1.62.1') throw fail('PLAYWRIGHT_VERSION_MISMATCH');
  const registry = JSON.parse(fs.readFileSync(path.join(path.dirname(requireApp.resolve('playwright-core/package.json')), 'browsers.json'), 'utf8'));
  const chromium = registry.browsers?.find(item => item.name === 'chromium');
  if (chromium?.revision !== '1234' || chromium.browserVersion !== '151.0.7922.34') throw fail('PLAYWRIGHT_BROWSER_REGISTRY_MISMATCH');
  const temporaryHome = fs.mkdtempSync('/tmp/qingdao-media-smoke-');
  fs.chmodSync(temporaryHome, 0o700);
  let phase = 'dependencies';
  try {
    const dependencies = await inspectDependencies(requireApp);
    phase = 'chromium';
    const browser = await inspectBrowser(requireApp('playwright-core').chromium, browserExecutable, temporaryHome, chromium.browserVersion);
    phase = 'audio';
    const audio = inspectAudio();
    return {
      status: 'media_smoke_passed', nodeVersion: process.versions.node, uid: process.getuid(),
      externalNetwork: false, databaseConnected: false, applicationImported: false, modelCalled: false,
      dependencyCoverage: 'mysql2, drizzle-orm/mysql2, sharp and playwright-core only; not every package or application feature',
      dependencies, playwrightVersion: playwrightPackage.version, browser, audio,
    };
  } catch (error) {
    throw Object.assign(fail(error.safeCode || 'MEDIA_SMOKE_FAILED'), { phase });
  } finally {
    // Only this freshly created private temporary HOME, never app/user files.
    fs.rmSync(temporaryHome, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.umask(0o077);
  // Backstop for native/library stalls. Playwright registers exit cleanup for
  // its browser process; normal paths also explicitly await browser.close().
  const deadline = setTimeout(() => {
    console.error(JSON.stringify({ status: 'media_smoke_failed', error: 'MEDIA_SMOKE_TOTAL_TIMEOUT' }));
    process.exit(1);
  }, 55000);
  let passed = false;
  try {
    if (process.argv.length !== 4) throw fail('USAGE_APP_DIRECTORY_BROWSER_EXECUTABLE');
    console.log(JSON.stringify(await verifyMedia(...process.argv.slice(2)), null, 2));
    passed = true;
  } catch (error) {
    // A timed-out browser.close() may leave handles alive. Flush the small safe
    // result, then exit explicitly so Playwright's exit handler kills its tree.
    // Keep the hard deadline armed if even stderr cannot finish flushing.
    process.stderr.write(`${JSON.stringify({ status: 'media_smoke_failed', error: error.safeCode || 'MEDIA_SMOKE_FAILED', phase: error.phase })}\n`, () => process.exit(1));
  } finally { if (passed) clearTimeout(deadline); }
}
