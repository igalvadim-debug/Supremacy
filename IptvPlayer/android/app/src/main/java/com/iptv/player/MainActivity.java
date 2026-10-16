package com.iptv.player;

import android.graphics.Color;
import android.os.Bundle;
import android.util.Log;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(IptvNativePlugin.class);
        registerPlugin(IptvPlayerPlugin.class);
        super.onCreate(savedInstanceState);

        // Прозрачный WebView, чтобы нативное видео (TextureView) просвечивало снизу под HTML-оверлеями.
        WebView wv = getBridge().getWebView();
        if (wv != null) {
            wv.setBackgroundColor(Color.TRANSPARENT);
            View parent = (View) wv.getParent();
            if (parent != null) parent.setBackgroundColor(Color.TRANSPARENT);
        }
        View content = findViewById(android.R.id.content);
        if (content instanceof ViewGroup) ((ViewGroup) content).setBackgroundColor(Color.TRANSPARENT);

        // Фон окна — тёмный. Страница в нативном режиме прозрачная, поэтому видео (TextureView)
        // видно и в меню (превью), и на весь экран, а не занятые видео области — тёмный фон.
        getWindow().getDecorView().setBackgroundColor(0xFF0B0F19);
    }

    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        if (event.getAction() == KeyEvent.ACTION_DOWN) Log.d("IPTVKEY", "keycode " + event.getKeyCode());
        // Кнопка «три полоски» (Menü) на пульте — вкл/выкл избранное. Ловим нативно, чтобы не зависеть от доставки в WebView.
        if (event.getKeyCode() == KeyEvent.KEYCODE_MENU && event.getAction() == KeyEvent.ACTION_DOWN) {
            try {
                WebView wv = getBridge().getWebView();
                if (wv != null) wv.evaluateJavascript("window.__iptvMenu&&window.__iptvMenu()", null);
            } catch (Exception ignored) {
                // ignore
            }
            return true;
        }
        return super.dispatchKeyEvent(event);
    }
}
