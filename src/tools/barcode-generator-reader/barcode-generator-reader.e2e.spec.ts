import { Buffer } from 'node:buffer';

import { expect, test } from '@playwright/test';
import QRCode from 'qrcode';

test.describe('Tool - Barcode generator and reader', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/barcode-generator-reader');
  });

  test('generates and downloads a local Code 128 SVG', async ({ page }) => {
    await expect(page).toHaveTitle('Barcode generator and reader - IT Tools');
    await expect(page.getByTestId('barcode-preview')).toBeVisible();
    await page.getByTestId('barcode-value').fill('PRIVATE-LOCAL-42');
    await expect(page.getByTestId('barcode-stale')).toBeVisible();
    await page.getByTestId('barcode-generate').click();
    await expect(page.getByTestId('barcode-preview').locator('img')).toHaveAttribute('alt', /PRIVATE-LOCAL-42/);

    const downloadPromise = page.waitForEvent('download');
    await page.getByTestId('barcode-download').click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe('code128-barcode.svg');
    expect(page.url()).not.toContain('PRIVATE-LOCAL-42');
    expect(await page.evaluate(() => Object.values(localStorage).every(value => !value.includes('PRIVATE-LOCAL-42')))).toBe(true);
  });

  test('validates and appends an EAN-13 checksum', async ({ page }) => {
    await page.getByRole('combobox', { name: 'Format' }).click();
    await page.getByRole('option', { name: 'EAN-13' }).click();
    await page.getByTestId('barcode-value').fill('590123412345');
    await page.getByTestId('barcode-generate').click();
    await expect(page.getByTestId('barcode-preview').locator('img')).toHaveAttribute('alt', /5901234123457/);
  });

  test('discloses reader availability without processing a file on load', async ({ page }) => {
    await expect(page.getByTestId('barcode-reader-status')).not.toContainText('Checking', { timeout: 5_000 });
    const status = await page.getByTestId('barcode-reader-status').textContent();
    expect(status).toMatch(/Reader available|not available/);
  });

  test('uses the local QR fallback when native BarcodeDetector is absent', async ({ page }) => {
    await page.addInitScript(() => {
      Reflect.deleteProperty(globalThis, 'BarcodeDetector');
    });
    await page.goto('/barcode-generator-reader');

    const value = 'firefox-local-qr';
    const qrDataUrl = await QRCode.toDataURL(value, { margin: 4, width: 512 });
    await page.locator('input[type="file"]').setInputFiles({
      buffer: Buffer.from(qrDataUrl.slice(qrDataUrl.indexOf(',') + 1), 'base64'),
      mimeType: 'image/png',
      name: 'firefox-barcode.png',
    });

    await expect(page.getByTestId('barcode-read')).toBeEnabled();
    await page.getByTestId('barcode-read').click();
    await expect(page.getByTestId('barcode-results')).toContainText('qr_code');
    await expect(page.getByTestId('barcode-results')).toContainText(value);
  });
});
