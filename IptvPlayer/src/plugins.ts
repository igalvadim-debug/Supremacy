import type { AppPlugin } from '@capacitor/app';
import type { CapacitorHttp, PluginListenerHandle } from '@capacitor/core';
export type CapacitorHttpType = typeof CapacitorHttp;
import type { EpgInfo, EpgProgram, FilesResponse, ServerStatus } from './models';

export interface EpgLookupResponse { results?: { i: number; n?: EpgProgram | null; x?: EpgProgram | null }[]; }

/** Contracts consumed by the web client; the original native implementations remain authoritative. */
export interface IptvNativePlugin {
  readFile(options: { name: string }): Promise<{ text: string }>;
  listFiles(): Promise<FilesResponse>;
  deleteFile(options: { name: string }): Promise<void>;
  writeFile?(options: { name: string; text: string }): Promise<void>;
  serverStatus(): Promise<ServerStatus>;
  serverStart(options: { port: number }): Promise<ServerStatus>;
  serverStop(): Promise<ServerStatus>;
  epgLoad(options: { source: string; name: string; url: string; ids: string[]; names: string[]; sig: string; force: boolean }): Promise<EpgInfo>;
  epgLookup(options: { items: { id: string; name: string; alt: string }[] }): Promise<EpgLookupResponse>;
  epgSchedule(options: { id: string; name: string; alt: string; limit: number }): Promise<{ programs?: EpgProgram[] }>;
  getAutoStart?(): Promise<{ on: boolean }>;
  setAutoStart?(options: { on: boolean }): Promise<void>;
  clearCache?(): Promise<{ freed: number }>;
}
export interface NativePlayerEvent { state: string; message?: string; status?: number; }
export interface IptvPlayerPlugin {
  addListener(event: 'state', listener: (event: NativePlayerEvent) => void): Promise<PluginListenerHandle>;
  setBounds(options: { x: number; y: number; w: number; h: number }): Promise<void>;
  setVisible(options: { visible: boolean }): Promise<void>;
  play(options: { url: string; bufferMs: number }): Promise<void>;
  stop(): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
}
export interface CapacitorPlugins {
  IptvNative: IptvNativePlugin;
  IptvPlayer: IptvPlayerPlugin;
  App: AppPlugin;
  CapacitorHttp: CapacitorHttpType;
}
export interface CapacitorGlobal {
  isNativePlatform?(): boolean;
  getPlatform?(): string;
  Plugins?: Partial<CapacitorPlugins>;
  registerPlugin?<K extends keyof CapacitorPlugins>(name: K): CapacitorPlugins[K];
}
