import type Hls from 'hls.js';
import type qrcode from 'qrcode-generator';
import type { CapacitorGlobal } from './plugins';
import type { RemoteCommand, RemoteResponse } from './models';

declare global {
  interface Window {
    /** CDN library or the unchanged local fallback in /vendor/. */
    Hls?: typeof Hls;
    qrcode?: typeof qrcode;
    /** Injected by the native WebView bridge; absent in an ordinary browser. */
    Capacitor?: CapacitorGlobal;
    __iptvMenu?: () => void;
    RemoteAPI?: { handle(cmd: RemoteCommand): RemoteResponse };
  }
  const Capacitor: CapacitorGlobal | undefined;
}
export {};
