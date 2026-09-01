import {
  BARCODE_MAX_IMAGE_PIXELS,
  BARCODE_MAX_VALUE_LENGTH,
  readBarcodesFromFile,
  readQrCodesFromVideo,
  supportsQrReader,
} from '../barcode-generator-reader/barcode-reader.service';

export const QR_MAX_PAYLOAD_CHARACTERS = BARCODE_MAX_VALUE_LENGTH;
export const QR_CAMERA_MAX_DURATION_MS = 5 * 60_000;

export type OtpKind = 'totp' | 'hotp';
export type OtpAlgorithm = 'SHA1' | 'SHA256' | 'SHA512';

export interface ParsedOtpAuth {
  kind: OtpKind
  account: string
  issuer: string
  secret: string
  algorithm: OtpAlgorithm
  digits: 6 | 8
  period?: number
  counter?: number
  warning?: string
}

export async function supportsQrDecoder(): Promise<boolean> {
  return supportsQrReader();
}

export async function decodeQrFile(file: File): Promise<string[]> {
  const results = await readBarcodesFromFile(file, ['qr_code']);
  return results.filter(result => result.format === 'qr_code').map(result => result.rawValue);
}

export async function decodeQrVideoFrame(video: HTMLVideoElement): Promise<string[]> {
  if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || video.videoWidth < 1 || video.videoHeight < 1) {
    throw new Error('The camera frame is not ready yet.');
  }
  if (video.videoWidth * video.videoHeight > BARCODE_MAX_IMAGE_PIXELS) {
    throw new Error(`Camera frames are limited to ${BARCODE_MAX_IMAGE_PIXELS.toLocaleString('en-US')} pixels.`);
  }
  const results = await readQrCodesFromVideo(video);
  return results.filter(result => result.format === 'qr_code').map(result => result.rawValue);
}

function parseIntegerParameter(value: string | null, fallback: number, name: string): number {
  const source = value ?? String(fallback);
  if (!/^\d+$/u.test(source)) {
    throw new Error(`${name} must be a whole number.`);
  }
  const parsed = Number(source);
  if (!Number.isSafeInteger(parsed)) {
    throw new TypeError(`${name} is outside the supported range.`);
  }
  return parsed;
}

function decodeLabel(pathname: string): string {
  try {
    return decodeURIComponent(pathname.replace(/^\//u, ''));
  }
  catch {
    throw new Error('The OTP account label contains invalid percent encoding.');
  }
}

export function parseOtpAuthUri(input: unknown): ParsedOtpAuth {
  if (typeof input !== 'string' || input.length < 1 || input.length > QR_MAX_PAYLOAD_CHARACTERS) {
    throw new Error(`OTP URI must contain 1 to ${QR_MAX_PAYLOAD_CHARACTERS.toLocaleString('en-US')} characters.`);
  }
  const schemeMatch = /^otpauth:\/\/(totp|hotp)\//iu.exec(input);
  if (!schemeMatch) {
    throw new Error('Only otpauth://totp and otpauth://hotp URIs are supported.');
  }
  let url: URL;
  try {
    // Older Chromium treats non-special schemes as an opaque path and leaves
    // hostname empty. Parse the already-validated authority through the
    // equivalent HTTPS grammar so otpauth behaves consistently across engines.
    url = new URL(`https://${schemeMatch[1]}/${input.slice(schemeMatch[0].length)}`);
  }
  catch {
    throw new Error('Enter a valid otpauth:// URI.');
  }
  if (url.hostname !== 'totp' && url.hostname !== 'hotp') {
    throw new Error('Only otpauth://totp and otpauth://hotp URIs are supported.');
  }
  if (url.username || url.password || url.port || url.hash) {
    throw new Error('The OTP URI contains unsupported authority or fragment data.');
  }
  const label = decodeLabel(url.pathname).trim();
  if (!label || label.length > 512) {
    throw new Error('The OTP account label is required and limited to 512 characters.');
  }
  const colonIndex = label.indexOf(':');
  const labelIssuer = colonIndex >= 0 ? label.slice(0, colonIndex).trim() : '';
  const account = (colonIndex >= 0 ? label.slice(colonIndex + 1) : label).trim();
  if (!account) {
    throw new Error('The OTP account name is required.');
  }

  const secretValue = url.searchParams.get('secret')?.replace(/\s+/gu, '').replace(/=+$/u, '').toUpperCase() ?? '';
  if (!secretValue || secretValue.length > 1_024 || !/^[A-Z2-7]+$/u.test(secretValue)) {
    throw new Error('The OTP secret must be a Base32 value no longer than 1,024 characters.');
  }
  const algorithmValue = (url.searchParams.get('algorithm') ?? 'SHA1').toUpperCase();
  if (algorithmValue !== 'SHA1' && algorithmValue !== 'SHA256' && algorithmValue !== 'SHA512') {
    throw new Error('OTP algorithm must be SHA1, SHA256, or SHA512.');
  }
  const digitsValue = parseIntegerParameter(url.searchParams.get('digits'), 6, 'Digits');
  if (digitsValue !== 6 && digitsValue !== 8) {
    throw new Error('OTP digits must be 6 or 8.');
  }
  const issuer = (url.searchParams.get('issuer') ?? labelIssuer).trim();
  if (issuer.length > 256) {
    throw new Error('OTP issuer is limited to 256 characters.');
  }
  const warning = labelIssuer && issuer && labelIssuer !== issuer
    ? 'The issuer query parameter differs from the issuer in the account label.'
    : undefined;

  const common = {
    kind: url.hostname,
    account,
    issuer,
    secret: secretValue,
    algorithm: algorithmValue,
    digits: digitsValue,
    ...(warning ? { warning } : {}),
  } as const;
  if (url.hostname === 'totp') {
    const period = parseIntegerParameter(url.searchParams.get('period'), 30, 'Period');
    if (period < 1 || period > 300) {
      throw new Error('OTP period must be between 1 and 300 seconds.');
    }
    return { ...common, kind: 'totp', period };
  }
  const counter = parseIntegerParameter(url.searchParams.get('counter'), 0, 'Counter');
  return { ...common, kind: 'hotp', counter };
}
