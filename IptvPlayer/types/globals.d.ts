/* Глобальные объявления для checkJs: CDN-библиотеки и Capacitor-мост. */

/** hls.js (CDN) */
declare const Hls: any;

/**
 * Create a QR code generator using qrcode-generator (CDN).
 * Add data and call make() before rendering the symbol.
 * @param typeNumber QR version from 1 to 40; values below 1 select a version
 * automatically on the first make() call.
 * @param errorCorrectionLevel One of 'L', 'M', 'Q', or 'H'.
 */
declare function qrcode(typeNumber: number, errorCorrectionLevel: string): {
  /**
   * Append text in byte mode using the library's current string-to-byte converter.
   * Call make() again before rendering the updated data.
   */
  addData(data: string): void;
  /**
   * Build or rebuild the symbol from the accumulated data.
   * @throws {string} If the data exceeds the selected version's capacity or the
   * error correction level is unsupported.
   */
  make(): void;
  /**
   * Return an img markup string with a GIF data URL after make().
   * @param cellSize Pixels per module; omitted or zero uses 2.
   * @param margin Whitespace in pixels; defaults to four modules. Zero removes it.
   */
  createImgTag(cellSize?: number, margin?: number): HTMLElement;
  /**
   * Return SVG markup as a string after make().
   * @param opts Options for cellSize (pixels per module, default 2), margin
   * (pixels, default four modules), scalable (omit fixed dimensions), and alt
   * and title (accessible text or objects with text and id). A number sets only
   * the cell size.
   */
  createSvgTag(opts?: unknown): SVGElement;
  [key: string]: any;
};

interface CapacitorBridge {
  /** Return whether the current platform is other than 'web', including custom platforms. */
  isNativePlatform?(): boolean;
  /** Return 'web', 'android', 'ios', or the configured custom platform name. */
  getPlatform?(): string;
  /**
   * Register a plugin and expose its proxy through Plugins, or return the
   * existing proxy if the name is already registered.
   * Proxy method promises may reject with a CapacitorException with code
   * 'UNIMPLEMENTED' for missing plugins or methods, or propagate loader and
   * implementation errors.
   * @param name Plugin identifier used by the native bridge.
   * @param impl Optional map of platform names to JavaScript implementations or
   * lazy loaders that return implementations, possibly asynchronously.
   */
  registerPlugin(name: string, impl?: any): any;
  Plugins?: Record<string, any>;
}

declare interface Window {
  Capacitor?: CapacitorBridge;
  RemoteAPI?: Record<string, unknown>;
  Hls?: any;
  __iptvMenu?: () => void;
}
