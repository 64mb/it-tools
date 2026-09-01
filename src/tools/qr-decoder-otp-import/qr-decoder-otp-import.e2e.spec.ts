import { Buffer } from 'node:buffer';

import { expect, test } from '@playwright/test';
import QRCode from 'qrcode';

test.use({ serviceWorkers: 'block' });

test.describe('Tool - QR decoder and OTP import', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/qr-decoder-otp-import');
  });

  test('parses a manually supplied OTP payload without starting the camera', async ({ page }) => {
    await expect(page).toHaveTitle('QR Decoder & OTP Import - IT Tools');
    await expect(page.getByTestId('qr-camera-preview')).toHaveJSProperty('srcObject', null);
    await page.getByTestId('qr-payload').fill('otpauth://totp/Example:alice?secret=JBSWY3DPEHPK3PXP&issuer=Example&digits=8');
    await page.getByTestId('qr-parse-otp').click();
    await expect(page.getByTestId('otp-result')).toContainText('"kind": "totp"');
    await expect(page.getByTestId('otp-result')).toContainText('"secret": "JBSWY3DPEHPK3PXP"');
    await expect(page.getByTestId('qr-status')).toContainText('configuration parsed locally');
  });

  test('rejects invalid provisioning data and does not persist secrets', async ({ page }) => {
    const secret = 'NOT-BASE32';
    await page.getByTestId('qr-payload').fill(`otpauth://totp/alice?secret=${secret}`);
    await page.getByTestId('qr-parse-otp').click();
    await expect(page.getByTestId('qr-error')).toContainText('Base32');
    const stored = await page.evaluate(() => [...Object.values(localStorage), ...Object.values(sessionStorage)].join('\n'));
    expect(stored).not.toContain(secret);
    await page.reload();
    await expect(page.getByTestId('qr-payload')).toHaveValue('');
  });

  test('decodes a local OTP QR image without native BarcodeDetector', async ({ page }) => {
    await page.addInitScript(() => {
      Reflect.deleteProperty(globalThis, 'BarcodeDetector');
    });
    await page.goto('/qr-decoder-otp-import');

    const otpUri = 'otpauth://totp/Firefox:alice?secret=JBSWY3DPEHPK3PXP&issuer=Firefox';
    const qrDataUrl = await QRCode.toDataURL(otpUri, { margin: 4, width: 512 });
    await page.locator('input[type="file"]').setInputFiles({
      buffer: Buffer.from(qrDataUrl.slice(qrDataUrl.indexOf(',') + 1), 'base64'),
      mimeType: 'image/png',
      name: 'firefox-otp.png',
    });

    await expect(page.getByTestId('qr-decode-file')).toBeEnabled();
    await page.getByTestId('qr-decode-file').click();
    await expect(page.getByTestId('qr-payload')).toHaveValue(otpUri);
    await expect(page.getByTestId('qr-status')).toContainText('OTP QR payload decoded');
  });

  test('starts a Firefox-compatible camera stream and decodes one frame', async ({ page, browserName }) => {
    test.skip(browserName === 'webkit', 'WebKit does not implement the canvas.captureStream fixture used to emulate a local camera.');
    const otpUri = 'otpauth://totp/Camera:alice?secret=JBSWY3DPEHPK3PXP&issuer=Camera';
    const qrDataUrl = await QRCode.toDataURL(otpUri, { margin: 4, width: 512 });
    await page.addInitScript(async ({ imageUrl }) => {
      Reflect.deleteProperty(globalThis, 'BarcodeDetector');
      const getUserMedia = async (): Promise<MediaStream> => {
        const canvas = document.createElement('canvas');
        canvas.width = 512;
        canvas.height = 512;
        const context = canvas.getContext('2d');
        const image = new Image();
        image.src = imageUrl;
        await new Promise<void>((resolve, reject) => {
          image.addEventListener('load', () => resolve(), { once: true });
          image.addEventListener('error', () => reject(new Error('QR camera fixture failed to load.')), { once: true });
        });
        context?.drawImage(image, 0, 0, canvas.width, canvas.height);
        const cameraStream = canvas.captureStream(5);
        Object.assign(globalThis, { __qrCameraStream: cameraStream });
        return cameraStream;
      };
      const mediaDevices = navigator.mediaDevices ?? {};
      Object.defineProperty(mediaDevices, 'getUserMedia', { configurable: true, value: getUserMedia });
      if (!navigator.mediaDevices) {
        Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: mediaDevices });
      }
    }, { imageUrl: qrDataUrl });
    await page.goto('/qr-decoder-otp-import');

    await expect(page.getByTestId('qr-start-camera')).toBeEnabled();
    await page.getByTestId('qr-start-camera').click();
    await expect(page.getByTestId('qr-status')).toContainText('Camera active');
    await page.getByTestId('qr-decode-frame').click();
    await expect(page.getByTestId('qr-payload')).toHaveValue(otpUri);
    await page.getByTestId('qr-stop-camera').click();
    await expect(page.getByTestId('qr-status')).toHaveText('Camera stopped.');
    await expect.poll(() => page.evaluate(() => (
      (globalThis as typeof globalThis & { __qrCameraStream?: MediaStream }).__qrCameraStream
        ?.getTracks().every(track => track.readyState === 'ended')
    ))).toBe(true);
  });
});
