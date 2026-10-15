/**
 * Декларации для библиотек, подключаемых через CDN (window.Hls, window.qrcode).
 * Типизированы минимально — только то, что реально используется в коде приложения.
 */

// ---- hls.js (только используемые части) ----------------------------------
interface HlsConfigPartial {
  enableWorker?: boolean;
  lowLatencyMode?: boolean;
  backBufferLength?: number;
  maxBufferLength?: number;
  maxMaxBufferLength?: number;
  /** стартовая позиция live-синхронизации, сек (используется при заданном буфере) */
  liveSyncDuration?: number;
  /** число сегментов для live-синхронизации (используется при буфере = 0) */
  liveSyncDurationCount?: number;
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
  /** восстановление после фатальной ошибки MEDIA_ERROR без пересоздания экземпляра */
  recoverMediaError(): void;
  destroy(): void;
  on(event: string, handler: (event: string, data?: HlsErrorData) => void): void;
  once(event: string, handler: (event: string, data?: HlsErrorData) => void): void;
  off(event: string, handler?: (...args: unknown[]) => void): void;
}

// ---- qrcode-generator (только используемые части) -------------------------
interface QrcodeInstance {
  addData(data: string): void;
  make(): void;
  /** позиционная форма: размер ячейки и поле (используется в src/index.ts) */
  createSvgTag(cellSize: number, margin: number): string;
  /** опциональная форма API qrcode-generator */
  createSvgTag(opts: { cellSize?: number | string; margin?: number | string; scalable?: boolean }): string;
  getModuleCount(): number;
  isDark(row: number, col: number): boolean;
}

type QrcodeFactory = (typeNumber: number, errorCorrectionLevel: string) => QrcodeInstance;

// ---- API пульта ДУ (объявление в src/index.ts: window.RemoteAPI) ----------
interface RemoteCommand {
  cmd?: string;
  url?: string;
  name?: string;
  key?: string;
  pin?: string;
  on?: boolean | string | number;
  i?: number | string;
  q?: string;
  target?: string;
  sources?: string;
  [k: string]: unknown;
}

interface RemoteApiGlobal {
  /** обработка команды от веб-пульта (/api/remote); возвращает состояние или результат */
  handle(cmd: RemoteCommand): unknown;
}

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
    /** открытие главного меню плеера из нативного кода (MainActivity) — объявлено в src/index.ts */
    __iptvMenu?: () => void;
    /** API веб-пульта (/api/remote) — объявлено в src/index.ts */
    RemoteAPI?: RemoteApiGlobal;
  }

  /** Глобальный `Capacitor` доступен как window.Capacitor в нативном WebView. */
  const Capacitor: CapacitorGlobal | undefined;
}

export {};
