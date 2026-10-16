/** Wire and persistence models. Field names match the existing Java/JSON protocol. */
export interface Channel {
  name: string;
  url: string;
  logo: string;
  group: string;
  tvgId: string;
  tvgName: string;
  catchup: string;
  catchupSource: string;
  catchupDays: number;
  nameLower: string;
  groupLower: string;
}
export type ChannelInput = Partial<Channel> & { url: string };
export interface Group { key: string; label: string; count: number; }
export interface PlaylistSource { kind: 'url' | 'file'; key: string; }
export interface PlaylistIdentity {
  id: string; kind: 'url' | 'file'; url: string; fileName: string;
}
export interface PlaylistEntry extends PlaylistIdentity {
  name: string; text: string; count: number; savedAt: number;
}
export interface PlaylistOptions { keep?: boolean; nosave?: boolean; }
export interface PlayerState {
  channels: Channel[]; view: Channel[]; groups: Group[]; group: string;
  current: Channel | null; entry: PlaylistIdentity | null;
  mode: 'menu' | 'player'; renderCount: number;
}
export interface Settings { bufferMs: number; autoReload: boolean; reloadHours: number; }
export interface CatchupDefaults { mode: string; source: string; days: number; }
export interface EpgProgram { s: number; e: number; t: string; d?: string; }
export interface EpgNowNext { n: EpgProgram | null; x: EpgProgram | null; }
export interface EpgInfo { source: string; channels: number; programmes: number; loadedAt: number; }
export interface EpgState {
  enabled: boolean; file: string; status: 'none' | 'off' | 'loading' | 'ok' | 'error';
  info: EpgInfo | null; err: string; loading: boolean; pending: '' | 'force' | 'normal';
  cache: Map<Channel, EpgNowNext | null>;
}
export interface ServerStatus { running: boolean; port: number; addresses: string[]; }
export interface ServerFile { name: string; size: number; modified: number; }
export interface FilesResponse { files: ServerFile[]; }
export interface UploadResponse { ok?: boolean; size?: number; error?: string; }
export interface RemoteCommand {
  cmd?: string; url?: string; name?: string; key?: string; pin?: string;
  current?: string | number; on?: boolean | string | number; i?: number | string;
  q?: string; target?: string; sources?: string | string[];
}
export interface RemoteChannel {
  i: number; name: string; group: string; url: string; playing: boolean; fav: boolean;
}
export interface RemoteSnapshot {
  lang?: string;
  current: Pick<Channel, 'name' | 'group' | 'url'> | null;
  playing: boolean; paused: boolean; count: number; viewCount: number;
  query: string; group: string; groups: Group[]; favGroup: string; favCount: number;
  blocked: string[]; pinSet: boolean; locked: boolean; channels: RemoteChannel[];
}
/** Some commands return only an acknowledgment, others a complete snapshot. */
export interface RemoteResponse extends Partial<RemoteSnapshot> {
  ok: boolean; error?: string; note?: string; m3u?: string; moved?: number;
}
export interface RemoteState extends RemoteSnapshot { ok: true; moved?: number; }
export interface Point { x: number; y: number; }
export type Direction = 'left' | 'right' | 'up' | 'down';
export type RemoteKey = Direction | 'enter' | 'back' | null;
export interface NavMetadata {
  _act?: () => void;
  _armed?: boolean;
  _t?: number;
  _group?: string;
  _channel?: Channel;
  _idx?: number;
  _more?: boolean;
  _epg?: { root: HTMLElement; et: HTMLElement; fill: HTMLElement };
}
export type NavElement = HTMLElement & NavMetadata;
