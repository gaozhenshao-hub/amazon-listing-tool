import { describe, expect, it } from 'vitest';
import { createBrowserSlot } from './browserSlot';

describe('browser fallback memory limit', () => {
  it('queues a second browser and releases a slot only once', async () => {
    const acquire = createBrowserSlot();
    const first = await acquire();
    let secondStarted = false;
    const second = acquire().then(release => { secondStarted = true; return release; });
    await Promise.resolve();
    expect(secondStarted).toBe(false);
    first(); first();
    const releaseSecond = await second;
    let thirdStarted = false;
    const third = acquire().then(release => { thirdStarted = true; return release; });
    await Promise.resolve(); expect(thirdStarted).toBe(false);
    releaseSecond(); (await third)();
  });
  it('removes timed-out waiters without losing the next slot', async () => {
    const acquire = createBrowserSlot(10);
    const release = await acquire();
    await expect(acquire()).rejects.toThrow('capacity timeout');
    release(); (await acquire())();
  });
});
