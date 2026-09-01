import { describe, expect, it, vi } from 'vitest';
import {
  BARCODE_MAX_FILE_BYTES,
  BARCODE_MAX_IMAGE_PIXELS,
  getBarcodeReaderFormats,
  readBarcodesFromFile,
} from './barcode-reader.service';
import type { BarcodeReaderPlatform } from './barcode-reader.service';

function harness({ width = 100, height = 50, results = [{ format: 'code_128', rawValue: 'LOCAL-123' }] } = {}) {
  const close = vi.fn();
  const detect = vi.fn(async () => results);
  class Detector {
    static async getSupportedFormats() {
      return ['qr_code', 'code_128'];
    }

    async detect() {
      return detect();
    }
  }
  const platform: BarcodeReaderPlatform = {
    detector: Detector,
    createImageBitmap: vi.fn(async () => ({ width, height, close }) as unknown as ImageBitmap),
  };
  return { close, detect, platform };
}

describe('native barcode reader adapter', () => {
  it('reports supported formats and reads bounded local image results', async () => {
    const { close, detect, platform } = harness();
    await expect(getBarcodeReaderFormats(platform)).resolves.toEqual(['code_128', 'qr_code']);
    const file = new File(['image'], 'private.png', { type: 'image/png' });
    await expect(readBarcodesFromFile(file, ['code_128'], platform)).resolves.toEqual([
      { format: 'code_128', rawValue: 'LOCAL-123' },
    ]);
    expect(detect).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
  });

  it('rejects unsupported browsers, non-images, and oversized encoded files before decoding', async () => {
    const unavailable: BarcodeReaderPlatform = {
      detector: undefined,
      createImageBitmap: vi.fn(),
    };
    await expect(readBarcodesFromFile(new File(['x'], 'x.png', { type: 'image/png' }), [], unavailable))
      .rejects.toThrow(/not available/);
    const available = harness().platform;
    await expect(readBarcodesFromFile(new File(['x'], 'x.txt', { type: 'text/plain' }), [], available))
      .rejects.toThrow(/image/);
    const oversized = new File(['x'], 'large.png', { type: 'image/png' });
    Object.defineProperty(oversized, 'size', { value: BARCODE_MAX_FILE_BYTES + 1 });
    await expect(readBarcodesFromFile(oversized, [], available)).rejects.toThrow(/limited/);
  });

  it('falls back to local QR decoding when BarcodeDetector is unavailable', async () => {
    const close = vi.fn();
    const scanQr = vi.fn(async () => 'otpauth://totp/Firefox?secret=JBSWY3DPEHPK3PXP');
    const platform: BarcodeReaderPlatform = {
      detector: undefined,
      createImageBitmap: vi.fn(async () => ({ width: 256, height: 256, close }) as unknown as ImageBitmap),
      scanQr,
    };

    await expect(getBarcodeReaderFormats(platform)).resolves.toEqual(['qr_code']);
    await expect(readBarcodesFromFile(
      new File(['image'], 'firefox.png', { type: 'image/png' }),
      ['qr_code'],
      platform,
    )).resolves.toEqual([{
      format: 'qr_code',
      rawValue: 'otpauth://totp/Firefox?secret=JBSWY3DPEHPK3PXP',
    }]);
    expect(scanQr).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
  });

  it('closes decoded bitmaps after pixel-limit and result validation failures', async () => {
    const pixels = harness({ width: BARCODE_MAX_IMAGE_PIXELS + 1, height: 1 });
    await expect(readBarcodesFromFile(new File(['x'], 'x.png', { type: 'image/png' }), [], pixels.platform))
      .rejects.toThrow(/pixels/);
    expect(pixels.close).toHaveBeenCalledOnce();

    const invalid = harness({ results: [{ format: 'qr_code', rawValue: 'x'.repeat(4_097) }] });
    await expect(readBarcodesFromFile(new File(['x'], 'x.png', { type: 'image/png' }), [], invalid.platform))
      .rejects.toThrow(/invalid barcode result/);
    expect(invalid.close).toHaveBeenCalledOnce();
  });
});
