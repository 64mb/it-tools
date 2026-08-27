import { expect, test } from '@playwright/test';

const LOCAL_MODEL_PATH_FRAGMENT = '/assets/local-llm-models/';

test.use({ serviceWorkers: 'block' });

test.describe('Tool - Local LLM playground', () => {
  test('loads all three tiers without starting the model runtime or network download', async ({ page }) => {
    const modelRequests: string[] = [];
    page.on('request', (request) => {
      if (/huggingface\.co|local-llm\.worker(?:\.ts|-[^/?]+\.js)(?:\?|$)/iu.test(request.url())) {
        modelRequests.push(request.url());
      }
    });
    await page.goto('/local-llm-playground');

    await expect(page).toHaveTitle('Local LLM playground - IT Tools');
    await expect(page.getByRole('radio', { name: 'Lite · 0.8B' })).toBeVisible();
    await expect(page.getByRole('radio', { name: 'Standard · 2B' })).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByRole('radio', { name: 'Quality · 4B' })).toBeVisible();
    await expect(page.getByTestId('local-llm-model-summary')).toContainText('Approx. text-only q4 download');
    await page.waitForTimeout(250);
    expect(modelRequests).toEqual([]);
    expect(await page.evaluate(async () => typeof caches === 'undefined' ? [] : await caches.keys()))
      .not.toContain('it-tools-local-llm-models-v1');
  });

  test('keeps prompt content ephemeral across reloads', async ({ page }) => {
    const secret = 'ephemeral-local-llm-prompt-7bca';
    await page.goto('/local-llm-playground');
    await page.getByTestId('local-llm-prompt').fill(secret);
    expect(await page.evaluate(value => Object.values(localStorage).every(item => !item.includes(value)), secret)).toBe(true);
    expect(await page.evaluate(value => Object.values(sessionStorage).every(item => !item.includes(value)), secret)).toBe(true);
    await page.reload();
    await expect(page.getByTestId('local-llm-prompt')).toHaveValue('');
    expect(page.url()).not.toContain(secret);
  });

  test('loads model files only from the application origin', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'gpu', { configurable: true, value: {} });
    });
    await page.route('**/assets/local-llm-models/**', route => route.abort('blockedbyclient'));
    const externalModelRequests: string[] = [];
    page.on('request', (request) => {
      if (/huggingface\.co|hf\.co/iu.test(request.url())) {
        externalModelRequests.push(request.url());
      }
    });

    await page.goto('/local-llm-playground');
    const localRequest = page.waitForRequest(request => request.url().includes('/assets/local-llm-models/'));
    await page.getByTestId('local-llm-load').click();
    const request = await localRequest;

    expect(new URL(request.url()).origin).toBe(new URL(page.url()).origin);
    expect(request.url()).toContain(LOCAL_MODEL_PATH_FRAGMENT);
    await expect(page.getByTestId('local-llm-error')).toBeVisible();
    expect(externalModelRequests).toEqual([]);
  });

  test('keeps cold route work bounded before an explicit model load', async ({ browserName, page }, testInfo) => {
    test.skip(browserName !== 'chromium', 'Chromium is the performance baseline.');
    await page.addInitScript(() => {
      const durations: number[] = [];
      (window as Window & { __localLlmLongTasks?: number[] }).__localLlmLongTasks = durations;
      new PerformanceObserver(list => durations.push(...list.getEntries().map(entry => entry.duration)))
        .observe({ entryTypes: ['longtask'] });
    });
    await page.goto('/');
    const toolLink = page.getByRole('link', { name: /Local LLM playground/ }).first();
    await expect(toolLink).toBeVisible();
    await page.evaluate(() => {
      (window as Window & { __localLlmLongTasks?: number[] }).__localLlmLongTasks?.splice(0);
      performance.clearResourceTimings();
    });
    const startedAt = Date.now();
    await toolLink.click();
    await expect(page.getByTestId('local-llm-status')).not.toContainText('Checking');
    const readyMs = Date.now() - startedAt;
    const longestTaskMs = await page.evaluate(() => Math.max(0, ...(window as Window & { __localLlmLongTasks?: number[] }).__localLlmLongTasks ?? []));
    expect(longestTaskMs).toBeLessThan(100);
    await testInfo.attach('local-llm-cold-route.txt', {
      body: `${readyMs} ms cold route-ready; ${longestTaskMs.toFixed(1)} ms longest task; no model worker or weights before explicit Load`,
      contentType: 'text/plain',
    });
  });
});
