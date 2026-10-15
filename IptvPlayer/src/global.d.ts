/**
 * Декларации для библиотек, подключаемых через CDN (window.Hls, window.qrcode).
 * Типизированы минимально — только то, что реально используется в коде приложения.
 */

// ---- hls.js (только используемые части) ----------------------------------
interface HlsConfigPartial {
  lowLatencyMode?: boolean;
  backBufferLength?: number;
  maxBufferLength?: number;
  maxMaxBufferLength?: number;
  manifestLoadingTimeOut?: number;
  manifestLoadingMaxRetry?: number;
  levelLoadingTimeOut?: number;
  levelLoadingMaxRetry?: number;
  fragLoadingTimeOut?: number;
  fragLoadingMaxRetry?: number;
  [key: string]: unknown;
}

interface HlsErrorData {
  type: string;
  details: string;
  fatal: boolean;
  url?: string;
  response?: { code?: number };
  [key: string]: unknown;
}

interface HlsStatic {
  isSupported(): boolean;
  Events: Record<string, string>;
  ErrorTypes: Record<string, string>;
  ErrorDetails: Record<string, string>;
  version?: string;
  new (config?: HlsConfigPartial): HlsInstance;
}

interface HlsInstance {
  attachMedia(media: HTMLMediaElement): void;
  detachMedia(): void;
  loadSource(url: string): void;
  startLoad(startPosition?: number): void;
  destroy(): void;
  on(event: string, handler: (event: string, data?: HlsErrorData) => void): void;
  once(event: string, handler: (event: string, data?: HlsErrorData) => void): void;
  off(event: string, handler?: (...args: unknown[]) => void): void;
}

// ---- qrcode-generator (только используемые части) -------------------------
interface QrcodeInstance {
  addData(data: string): void;
  make(): void;
  createSvgTag(opts: { cellSize?: number | string; scalable?: boolean }): string;
  getModuleCount(): number;
  isDark(row: number, col: number): boolean;
}

type QrcodeFactory = (typeNumber: number, errorCorrectionLevel: string) => QrcodeInstance;

// ---- Capacitor (глобальный объект внедряется WebView-мостом) --------------
interface CapacitorPluginsPartial {
  [key: string]: any;
}

interface CapacitorGlobal {
  isNativePlatform?(): boolean;
  getPlatform?(): string;
  Plugins?: CapacitorPluginsPartial;
  [key: string]: any;
}

declare global {
  interface Window {
    /** hls.js, загружаемый с CDN (или локально из public/vendor/hls.min.js) */
    Hls?: HlsStatic;
    /** qrcode-generator, загружаемый с CDN */
    qrcode?: QrcodeFactory;
    /** мост Capacitor, внедряемый нативным WebView */
    Capacitor?: CapacitorGlobal;
  }

  /** Глобальный `Capacitor` доступен как window.Capacitor в нативном WebView. */
  const Capacitor: CapacitorGlobal | undefined;
}

export {};
