package com.iptv.player;

import android.app.Activity;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.TextureView;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.widget.FrameLayout;

import androidx.annotation.OptIn;
import androidx.media3.common.AudioAttributes;
import androidx.media3.common.C;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MimeTypes;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.datasource.DataSource;
import androidx.media3.datasource.DefaultDataSource;
import androidx.media3.datasource.DefaultHttpDataSource;
import androidx.media3.exoplayer.DefaultLoadControl;
import androidx.media3.exoplayer.DefaultRenderersFactory;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory;
import androidx.media3.exoplayer.trackselection.DefaultTrackSelector;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Нативное воспроизведение через AndroidX Media3 (ExoPlayer).
 * Нужно для кодеков, которые не умеет Android WebView (в первую очередь AC-3 / E-AC-3):
 * ExoPlayer использует системные декодеры устройства, поэтому звук появляется там, где hls.js молчит.
 *
 * Видео рисуется в {@link TextureView}, который добавлен ПОД WebView (индекс 0 в android.R.id.content).
 * WebView в MainActivity сделали прозрачным, поэтому HTML-оверлеи (OSD, EPG, панель) остаются поверх видео.
 * Размер/позицию прямоугольника видео задаёт JS методом {@link #setBounds}.
 */
@OptIn(markerClass = UnstableApi.class)
@CapacitorPlugin(name = "IptvPlayer")
public class IptvPlayerPlugin extends Plugin {

    private static final String UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

    private final Handler main = new Handler(Looper.getMainLooper());
    private ExoPlayer player;
    private TextureView texture;

    @Override
    public void load() {
        main.post(this::ensureTexture);
    }

    @Override
    protected void handleOnDestroy() {
        main.post(this::releasePlayer);
    }

    // ---------- подготовка вида/плеера ----------
    private void ensureTexture() {
        if (texture != null) return;
        Activity act = getActivity();
        if (act == null) return;
        View content = act.findViewById(android.R.id.content);
        if (!(content instanceof ViewGroup)) return;
        FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT);
        texture = new TextureView(act);
        texture.setLayoutParams(lp);
        texture.setVisibility(View.GONE);
        ((ViewGroup) content).addView(texture, 0); // позади WebView
    }

    private void ensurePlayer() {
        if (player != null) return;
        DefaultHttpDataSource.Factory http = new DefaultHttpDataSource.Factory()
                .setUserAgent(UA)
                .setAllowCrossProtocolRedirects(true)
                .setConnectTimeoutMs(20000)
                .setReadTimeoutMs(90000);
        DataSource.Factory ds = new DefaultDataSource.Factory(getContext(), http);
        // FFmpeg-декодер как запасной: на Fire TV нет системного декодера MP2/MP1 (и DTS), без него звук молчит.
        DefaultRenderersFactory renderers = new DefaultRenderersFactory(getContext())
                .setExtensionRendererMode(DefaultRenderersFactory.EXTENSION_RENDERER_MODE_ON);
        player = new ExoPlayer.Builder(getContext(), renderers)
                .setMediaSourceFactory(new DefaultMediaSourceFactory(ds))
                .setTrackSelector(new DefaultTrackSelector(getContext()))
                .setLoadControl(new DefaultLoadControl.Builder()
                        // быстрый старт канала: bufferForPlaybackMs снижен 2500→1500
                        .setBufferDurationsMs(5000, 60000, 1500, 3000)
                        .build())
                .setAudioAttributes(new AudioAttributes.Builder()
                        .setUsage(C.USAGE_MEDIA)
                        .setContentType(C.AUDIO_CONTENT_TYPE_MOVIE)
                        .build(), true)
                .build();
        player.addListener(new Player.Listener() {
            @Override
            public void onPlaybackStateChanged(int state) {
                JSObject o = new JSObject();
                switch (state) {
                    case Player.STATE_BUFFERING: o.put("state", "buffering"); break;
                    case Player.STATE_READY: o.put("state", "playing"); break;
                    case Player.STATE_ENDED: o.put("state", "ended"); break;
                    default: return;
                }
                notifyListeners("state", o);
            }

            @Override
            public void onPlayerError(PlaybackException error) {
                JSObject o = new JSObject();
                o.put("state", "error");
                o.put("message", error.getErrorCodeName());
                notifyListeners("state", o);
            }
        });
        if (texture != null) player.setVideoTextureView(texture);
    }

    private void releasePlayer() {
        if (player != null) {
            try {
                player.release();
            } catch (Exception ignored) {
                // уже освобождён
            }
            player = null;
        }
        if (texture != null) {
            texture.setVisibility(View.GONE);
        }
        keepScreenOn(false);
    }

    /** Явно задаём тип контейнера по расширению — иначе ExoPlayer иногда открывает .m3u8 как progressive. */
    private static MediaItem mediaItem(String url) {
        MediaItem.Builder b = new MediaItem.Builder().setUri(url);
        String lower = url.toLowerCase(java.util.Locale.ROOT);
        int q = lower.indexOf('?');
        String path = q >= 0 ? lower.substring(0, q) : lower;
        if (path.endsWith(".m3u8") || path.endsWith(".m3u")) b.setMimeType(MimeTypes.APPLICATION_M3U8);
        else if (path.endsWith(".mpd")) b.setMimeType(MimeTypes.APPLICATION_MPD);
        else if (path.endsWith(".ism") || path.contains(".ism/")) b.setMimeType(MimeTypes.APPLICATION_SS);
        return b.build();
    }

    /** Чтобы во время просмотра не включалась заставка / не гас экран. */
    private void keepScreenOn(boolean on) {
        Activity act = getActivity();
        if (act == null) return;
        if (on) act.getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        else act.getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    }

    // ---------- методы для JS ----------
    @PluginMethod
    public void play(final PluginCall call) {
        final String url = call.getString("url", "");
        final int bufferMs = call.getInt("bufferMs", 1500);
        if (url == null || url.isEmpty()) {
            call.reject("не указан url");
            return;
        }
        main.post(() -> {
            ensureTexture();
            ensurePlayer();
            if (texture != null) texture.setVisibility(View.VISIBLE);
            player.setMediaItem(mediaItem(url));
            player.prepare();
            player.setPlayWhenReady(true);
            keepScreenOn(true);
            JSObject r = new JSObject();
            r.put("ok", true);
            call.resolve(r);
        });
    }

    @PluginMethod
    public void pause(final PluginCall call) {
        main.post(() -> {
            if (player != null) player.setPlayWhenReady(false);
            call.resolve();
        });
    }

    @PluginMethod
    public void resume(final PluginCall call) {
        main.post(() -> {
            if (player != null) player.setPlayWhenReady(true);
            call.resolve();
        });
    }

    @PluginMethod
    public void stop(final PluginCall call) {
        main.post(() -> {
            if (player != null) {
                player.stop();
                player.clearMediaItems();
            }
            if (texture != null) texture.setVisibility(View.GONE);
            keepScreenOn(false);
            call.resolve();
        });
    }

    @PluginMethod
    public void setVisible(final PluginCall call) {
        final boolean visible = !Boolean.FALSE.equals(call.getBoolean("visible", true));
        main.post(() -> {
            if (texture != null) texture.setVisibility(visible ? View.VISIBLE : View.GONE);
            call.resolve();
        });
    }

    /** Прямоугольник видео в физических пикселях (JS передаёт getBoundingClientRect * devicePixelRatio). */
    @PluginMethod
    public void setBounds(final PluginCall call) {
        final int x = call.getInt("x", 0);
        final int y = call.getInt("y", 0);
        final int w = call.getInt("w", 0);
        final int h = call.getInt("h", 0);
        main.post(() -> {
            if (texture == null) {
                call.resolve();
                return;
            }
            FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(
                    Math.max(0, w), Math.max(0, h));
            lp.gravity = Gravity.TOP | Gravity.START;
            lp.leftMargin = Math.max(0, x);
            lp.topMargin = Math.max(0, y);
            texture.setLayoutParams(lp);
            call.resolve();
        });
    }
}
