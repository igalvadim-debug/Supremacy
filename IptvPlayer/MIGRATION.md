# IptvPlayer: Vite und TypeScript

**Strikte Typisierung aktiv ab jetzt.** Alle drei Vite-Entry-Points (`src/index.ts`,
`src/remote.ts`, `src/server-page.ts`) werden vollständig von TypeScript geprüft.
`strict: true` gilt ohne die bisherigen abschwächenden Overrides. `noEmit`,
`isolatedModules`, `skipLibCheck`, `allowJs: false`, `noFallthroughCasesInSwitch`
und `forceConsistentCasingInFileNames` bleiben aktiv. `skipLibCheck` betrifft
Deklarationsdateien; die Anwendungsdateien werden weiterhin geprüft.

## Was migriert wurde

- Vanilla-Code als ESM-Module, ohne IIFE-Wrapper; `const` und `let` statt `var`.
- Explizite Funktionsparameter, Rückgabewerte und Typen für den veränderlichen
  Modul-State. Keine Unterdrückung der Typprüfung und keine Escape-Typen.
- `src/models.ts`: Kanäle, Gruppen, Playlist-Identität und gespeicherte Einträge,
  EPG, Navigation, Remote-Kommandos und Server-Antworten.
- `src/plugins.ts`: die vom Web-Client verwendeten `IptvNative`-/`IptvPlayer`-Aufrufe.
  Die nativen Originalquellen bleiben maßgeblich für diese Schnittstellen.
- `src/global.d.ts`: vorhandene Bibliothekstypen für HLS, QR-Code und Capacitor;
  deklarierte Hooks `window.__iptvMenu` und `window.RemoteAPI.handle`.
- `src/dom.ts`: zentraler Zugriff auf erforderliche HTML-Elemente. Optionales
  Markup wird weiterhin nullable gelesen. Generische Elementtypen beziehen
  sich auf die statischen HTML-Entry-Points.
- Der bereits in `main` korrigierte Lockfile wird übernommen.

JSON-Antworten und IndexedDB-Lesezugriffe werden an ihren Schnittstellen auf das
bestehende Protokoll typisiert. Das ist keine neue Laufzeit-Schemavalidierung:
Fehlerbehandlung, Protokollfelder und UI-Abläufe sollen unverändert bleiben.
`unknown` wird für unbekannte Fehler und gespeicherte Favoritenwerte verwendet.
Die wenigen Non-null-Assertions betreffen bereits geprüfte Invarianten (z. B.
die nichtleere Upload-Queue, das statische Datei-Input oder verfügbare Player).

DOM-IDs, Klassen, Storage-Keys, URLs und globale/native Hook-Namen bleiben
unverändert. Es wurden keine Runtime-Abhängigkeiten und kein Framework ergänzt.
Die Android-Quellen, das Manifest, Gradle und `capacitor.config.ts` gehören nicht
zu dieser Änderung. Der in `main` entfernte alte `www/`-Ordner bleibt entfernt; Vite verwendet
ausschließlich die aktuellen Entry-Points und `src/`.

## Integration mit dem aktuellen main

Die Typisierung wurde auf `e57d6e7` rebasiert. Die PIN-Logik aus PR #3 bleibt
vollständig erhalten: `verifyPin()` teilt Fehlversuche und die Sperre nach fünf
Fehlversuchen für zehn Sekunden zwischen Bildschirm-PIN-Pad, Einstellungen und
Remote-Kommandos. Das erneute Öffnen des PIN-Pads setzt den Zähler nicht zurück.
Remote-PIN-Wechsel prüft den aktuellen PIN unverändert als vollständigen Wert.
Die DOM-Prüfung für die Zielgruppe und `FileList.item()` aus PR #3 bleiben erhalten.

## Entwicklung und Web-Build

Im Verzeichnis `IptvPlayer/` (Node >= 22 für Capacitor 8):

```sh
npm ci
npm run typecheck
npm run dev
npm run build
```

Vite stellt `/index.html`, `/remote.html` und `/server-page.html` bereit.
`npm run build` kopiert HLS nach `public/vendor` und erzeugt anschließend `dist/`
mit den drei HTML-Seiten, gebündelten Assets und `vendor/hls.min.js`.
Der lokale Vite-Server implementiert die nativen `/api/*`-Endpunkte nicht;
Remote und Datei-Seite zeigen dort ohne Test-Fixtures den bisherigen
Verbindungsfehler an.

## Android-Sync und APK

Voraussetzung ist das **originale Android-Projekt** mit den eigenen Plugins,
Manifest-Einträgen und Media3-/Jellyfin-FFmpeg-Abhängigkeiten. Falls `android/`
fehlt, diese vollständige Ordnerstruktur aus dem Originalbackup wiederherstellen.
`cap add android` erzeugt diese projektspezifischen Bestandteile nicht.

```sh
npm run sync
# entspricht: npm run build && cap sync android
npx cap open android
```

Auf Windows (PowerShell):

```powershell
cd android
.\gradlew.bat assembleDebug
```

Oder aus `IptvPlayer/` mit dem vorhandenen Windows-Skript:

```powershell
npm run apk
```

Auf Linux/macOS mit passendem JDK und Android SDK:

```sh
cd android
./gradlew assembleDebug
```

Ausgabe: `android/app/build/outputs/apk/debug/app-debug.apk`.
Die benötigten JDK-/SDK-Versionen bestimmt das originale Gradle-Projekt.
Erfolgreiche Web-Typprüfung ersetzt weder APK-Build noch Gerätetests für
EPG, WebServer, Fernbedienung und native Wiedergabe einschließlich MP2-Audio.

## Prüfnachweise

Zusätzlich zur fehlerfreien Typprüfung werden temporäre Zuweisungen vom Typ
`const __probe: number = "x"` in jedem der drei Entry-Points geprüft und danach
entfernt. Der Compiler muss für jede Datei TS2322 melden. Build und Browser-
Vergleich werden separat erfasst; Android-Nachweise benötigen die Originalquellen.
