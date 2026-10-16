# IPTV Player — состояние проекта (handoff)

## Что это
Android-TV IPTV-плеер: **Capacitor + Vite/TypeScript** (веб-UI) + **нативный Android (Java + Media3/ExoPlayer)**.
Пакет `com.iptv.player`. Картинку видео рисует нативный `TextureView` **под прозрачным WebView**, поэтому HTML-`<video>` прячется (`html.native #video { visibility: hidden }`).

## Где
- Репозиторий: https://github.com/igalvadim-debug/Supremacy (ветка `main`)
- Локально: `D:\capacitor\Supremacy\IptvPlayer`
- Второй проект `D:\capacitor\IptvPlayer` **удалён** — больше не нужен.

## Сборка
```bash
cd D:\capacitor\Supremacy\IptvPlayer
npm install
npm run sync                 # = npm run build && cap sync android (создаёт android/capacitor-cordova-android-plugins)
cd android && gradlew.bat assembleDebug
```
Либо просто запустить `build_apk.bat` в корне — он сам делает `npm run sync`, затем gradle.

**Признак полного APK — ~13.7 МБ** (есть media3+FFmpeg). Если APK ~4.5 МБ — нативный слой потерян.

## Деплой на Fire TV Cube
```bash
adb connect 192.168.181.20:5555
adb -s 192.168.181.20:5555 install -r android\app\build\outputs\apk\debug\app-debug.apk
adb -s 192.168.181.20:5555 shell monkey -p com.iptv.player -c android.intent.category.LAUNCHER 1
```

## Обязательные нюансы
- **JDK 21, не 25.** JAVA_HOME на машине смотрит на jdk-25 → Gradle 8.14.3 падает (`Unsupported class file major version 69`). Пин в `android/gradle.properties`: `org.gradle.java.home=C:/Program Files/Android/Android Studio/jbr`.
- **Перед gradle всегда `npm run sync`** — иначе нет `android/capacitor-cordova-android-plugins/` и правок веб-ассетов.
- Не копировать `res/` целиком из старых копий — там бывает битый `styles.xml` без `colors.xml`.

## Что уже исправлено
- Восстановлен нативный слой (Java-плагины + media3 + jellyfin-ffmpeg + `tv_banner` + manifest с leanback/BootReceiver).
- **WebServer: добавлен маршрут `/assets/*`** — без него страница загрузки и пульт висели на «Загрузка…» и не рисовались QR (JS страниц грузится из `/assets/*.js`).
- Ускорен старт канала: буфер ExoPlayer `bufferForPlaybackMs` 2500 → 1500 мс.
- `src/index.ts`: исправлен вызов `trLoose` (ожидает 1 аргумент).

## Веб-сервер приложения (файлы/пульт/QR)
- Включается тумблером в приложении; слушает порт 20000–60000.
- `/` — страница загрузки (две QR-карточки: «Загрузка файлов» и «Пульт»), `/remote` — пульт с телефона.
- Пульт умеет: выбор канала, полный экран (двойной тап), prev/next, избранное, поиск, группы (объединение/удаление), скрытие групп + PIN, переименование/удаление канала, загрузка плейлиста по ссылке, EPG, экспорт/сохранение M3U, сброс правок.

## Стек
Vite + TypeScript (strict), hls.js, qrcode-generator, Capacitor 8, AndroidX Media3 1.5.1 + Jellyfin FFmpeg-декодер (для MP2/DTS).
