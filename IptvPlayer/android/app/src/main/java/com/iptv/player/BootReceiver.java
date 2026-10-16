package com.iptv.player;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;

/** Автозапуск плеера после загрузки устройства (проверяется на Fire TV Cube). */
public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        String a = intent == null ? null : intent.getAction();
        if (!Intent.ACTION_BOOT_COMPLETED.equals(a)
                && !"android.intent.action.QUICKBOOT_POWERON".equals(a)
                && !"com.htc.intent.action.QUICKBOOT_POWERON".equals(a)) {
            return;
        }
        // Только на ТВ/приставках (leanback) — чтобы телефон не открывал плеер при загрузке.
        if (!context.getPackageManager().hasSystemFeature(PackageManager.FEATURE_LEANBACK)) return;
        // Настройка приложения (та же SharedPreferences, что пишет нативный плагин): выключен ли автозапуск.
        if (!context.getSharedPreferences("iptv_prefs", Context.MODE_PRIVATE).getBoolean("autoStart", true)) return;
        try {
            Intent i = new Intent(context, MainActivity.class);
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            context.startActivity(i);
        } catch (Exception ignored) {
            // фон-запуск запрещён платформой — просто ничего не делаем
        }
    }
}
