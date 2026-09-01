import QrScanner from 'qr-scanner';

export const BARCODE_MAX_FILE_BYTES = 20 * 1024 * 1024;
export const BARCODE_MAX_IMAGE_PIXELS = 25_000_000;
export const BARCODE_MAX_RESULTS = 50;
export const BARCODE_MAX_VALUE_LENGTH = 4_096;

export interface BarcodeReaderResult {
  format: string
  rawValue: string
}

interface NativeBarcode {
  format: string
  rawValue: string
}

interface NativeBarcodeDetector {
  detect: (source: CanvasImageSource) => Promise<NativeBarcode[]>
}

interface NativeBarcodeDetectorConstructor {
  new(options?: { formats?: string[] }): NativeBarcodeDetector
  getSupportedFormats?: () => Promise<string[]>
}

export interface BarcodeReaderPlatform {
  createImageBitmap: (file: Blob) => Promise<ImageBitmap>
  detector: NativeBarcodeDetectorConstructor | undefined
  scanQr?: (source: HTMLVideoElement | ImageBitmap) => Promise<string | undefined>
}

async function scanQr(source: HTMLVideoElement | ImageBitmap): Promise<string | undefined> {
  try {
    const result = await QrScanner.scanImage(source, { returnDetailedScanResult: true });
    return result.data;
  }
  catch (caught) {
    if (caught === QrScanner.NO_QR_CODE_FOUND) {
      return undefined;
    }
    throw caught instanceof Error ? caught : new Error(String(caught));
  }
}

function browserPlatform(): BarcodeReaderPlatform {
  const browser = globalThis as typeof globalThis & {
    BarcodeDetector?: NativeBarcodeDetectorConstructor
  };
  return {
    createImageBitmap: file => globalThis.createImageBitmap(file),
    detector: browser.BarcodeDetector,
    scanQr: import.meta.env.STANDALONE ? undefined : scanQr,
  };
}

async function getNativeBarcodeFormats(detector: NativeBarcodeDetectorConstructor | undefined): Promise<string[]> {
  if (!detector) {
    return [];
  }
  try {
    const formats = await detector.getSupportedFormats?.();
    return formats?.filter(format => typeof format === 'string').sort() ?? [];
  }
  catch {
    return [];
  }
}

export async function getBarcodeReaderFormats(platform = browserPlatform()): Promise<string[]> {
  const formats = await getNativeBarcodeFormats(platform.detector);
  return [...new Set([...formats, ...(platform.scanQr ? ['qr_code'] : [])])].sort();
}

function validateBarcodeResults(results: NativeBarcode[]): BarcodeReaderResult[] {
  if (!Array.isArray(results) || results.length > BARCODE_MAX_RESULTS) {
    throw new Error('The browser returned too many or invalid barcode results.');
  }
  return results.map((result) => {
    if (
      typeof result.format !== 'string'
      || typeof result.rawValue !== 'string'
      || result.rawValue.length > BARCODE_MAX_VALUE_LENGTH
    ) {
      throw new Error('The browser returned an invalid barcode result.');
    }
    return { format: result.format, rawValue: result.rawValue };
  });
}

async function readBarcodesFromSource(
  source: HTMLVideoElement | ImageBitmap,
  formats: string[],
  platform: BarcodeReaderPlatform,
): Promise<BarcodeReaderResult[]> {
  const supportedNativeFormats = await getNativeBarcodeFormats(platform.detector);
  const requestedNativeFormats = formats.length > 0
    ? formats.filter(format => supportedNativeFormats.includes(format))
    : supportedNativeFormats;
  const results: BarcodeReaderResult[] = [];

  if (platform.detector && requestedNativeFormats.length > 0) {
    const Detector = platform.detector;
    const nativeResults = await new Detector({ formats: requestedNativeFormats }).detect(source);
    results.push(...validateBarcodeResults(nativeResults));
  }

  const wantsQr = formats.length === 0 || formats.includes('qr_code');
  if (wantsQr && !requestedNativeFormats.includes('qr_code') && platform.scanQr) {
    const rawValue = await platform.scanQr(source);
    if (rawValue !== undefined) {
      results.push(...validateBarcodeResults([{ format: 'qr_code', rawValue }]));
    }
  }

  if (requestedNativeFormats.length === 0 && (!wantsQr || !platform.scanQr)) {
    throw new Error('Barcode detection is not available for the requested formats in this browser.');
  }
  if (results.length > BARCODE_MAX_RESULTS) {
    throw new Error('The browser returned too many or invalid barcode results.');
  }
  return results;
}

export async function supportsQrReader(platform = browserPlatform()): Promise<boolean> {
  return (await getBarcodeReaderFormats(platform)).includes('qr_code');
}

export async function readQrCodesFromVideo(
  video: HTMLVideoElement,
  platform = browserPlatform(),
): Promise<BarcodeReaderResult[]> {
  return readBarcodesFromSource(video, ['qr_code'], platform);
}

export async function readBarcodesFromFile(
  file: File,
  formats: string[],
  platform = browserPlatform(),
): Promise<BarcodeReaderResult[]> {
  if (!file.type.startsWith('image/')) {
    throw new Error('Select a local image file.');
  }
  if (!Number.isSafeInteger(file.size) || file.size < 1 || file.size > BARCODE_MAX_FILE_BYTES) {
    throw new Error(`Barcode images are limited to ${BARCODE_MAX_FILE_BYTES.toLocaleString('en-US')} bytes.`);
  }
  const availableFormats = await getBarcodeReaderFormats(platform);
  if (availableFormats.length === 0 || (formats.length > 0 && !formats.some(format => availableFormats.includes(format)))) {
    throw new Error('Barcode detection is not available for the requested formats in this browser.');
  }
  let bitmap: ImageBitmap | undefined;
  try {
    bitmap = await platform.createImageBitmap(file);
    if (
      !Number.isSafeInteger(bitmap.width)
      || !Number.isSafeInteger(bitmap.height)
      || bitmap.width < 1
      || bitmap.height < 1
      || bitmap.width * bitmap.height > BARCODE_MAX_IMAGE_PIXELS
    ) {
      throw new Error(`Decoded images are limited to ${BARCODE_MAX_IMAGE_PIXELS.toLocaleString('en-US')} pixels.`);
    }
    return await readBarcodesFromSource(bitmap, formats, platform);
  }
  finally {
    bitmap?.close();
  }
}
