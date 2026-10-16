/* Глобальные объявления для checkJs: CDN-библиотеки и Capacitor-мост. */

/** hls.js (CDN) */
declare const Hls: any;

/** qrcode-generator (CDN) */
declare function qrcode(typeNumber: number, errorCorrectionLevel: string): {
  addData(data: string): void;
  make(): void;
  createImgTag(cellSize?: number, margin?: number): HTMLElement;
  createSvgTag(opts?: unknown): SVGElement;
  [key: string]: any;
};

interface CapacitorBridge {
  isNativePlatform?(): boolean;
  getPlatform?(): string;
  registerPlugin(name: string, impl?: any): any;
  Plugins?: Record<string, any>;
}

declare interface Window {
  Capacitor?: CapacitorBridge;
  RemoteAPI?: Record<string, unknown>;
  Hls?: any;
  __iptvMenu?: () => void;
}
