#!/usr/bin/env bash
# build_deb.sh — Paketiert IPTV Player als Debian-Paket (amd64) ohne Electron.
#
# Konzept: Der mitgelieferte Node-Server (scripts/iptv-server.mjs) liefert die
# Web-UI (dist/) und die /native/*-Bridge aus; als "Fenster" dient ein im
# Kiosk-Modus gestarteter Browser (google-chrome / chromium / firefox --kiosk).
# Das erspart den Electron-Overhead (~250-400 MB RAM) — der Browser-Container
# bleibt deutlich leichter und nutzt vorhandene GPU-/Codec-Bibliotheken.
#
# Verwendung:
#   ./build_deb.sh [--version 1.0.0] [--arch amd64]
# Ergebnis:
#   dist-deb/iptv-player_<version>_<arch>.deb
#
# Abhängigkeiten des Pakets: nodejs, xdg-utils + einer der Browser
# (google-chrome-stable | chromium | chromium-browser | firefox), alle optional
# via "Recommends"-Logik: hart erforderlich ist nodejs; ein Browser wird über
# Depends mit ODER-Klausel erzwungen.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_ID="com.iptvplayer.linux"
VERSION="1.0.0"
ARCH="amd64"
MAINTAINER="IPTV Player <dev@iptvplayer.local>"
DESCRIPTION="IPTV Player für Linux: Node-Server + Kiosk-Browser (leichtgewichtiges .deb statt Electron)"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --version) VERSION="$2"; shift 2 ;;
    --arch)    ARCH="$2"; shift 2 ;;
    *) echo "Unbekannte Option: $1" >&2; exit 1 ;;
  esac
done

PKG_NAME="iptv-player"
BUILD_ROOT="${SCRIPT_DIR}/dist-deb/build-${PKG_NAME}_${VERSION}_${ARCH}"
PKG_DIR="${BUILD_ROOT}/${PKG_NAME}_${VERSION}_${ARCH}"
OUT_DIR="${SCRIPT_DIR}/dist-deb"
DEB_FILE="${OUT_DIR}/${PKG_NAME}_${VERSION}_${ARCH}.deb"

echo "==> Baue ${PKG_NAME}_${VERSION}_${ARCH}.deb"
rm -rf "$PKG_DIR"
mkdir -p "$PKG_DIR"

# ---------- Verzeichnisstruktur ----------
OPT="/opt/${PKG_NAME}"
mkdir -p "${PKG_DIR}${OPT}/server" "${PKG_DIR}${OPT}/web"
mkdir -p "${PKG_DIR}/usr/bin"
mkdir -p "${PKG_DIR}/usr/share/applications"
mkdir -p "${PKG_DIR}/usr/share/icons/hicolor/256x256/apps"
mkdir -p "${PKG_DIR}/DEBIAN"

# ---------- Web-App (dist/) ----------
if [[ ! -f "${SCRIPT_DIR}/dist/index.html" ]]; then
  echo "==> dist/ fehlt — baue Web-App (npm run build)"
  (cd "$SCRIPT_DIR" && npm ci --no-audit --no-fund >/dev/null 2>&1 || npm install --no-audit --no-fund)
  (cd "$SCRIPT_DIR" && npm run build)
fi
cp -a "${SCRIPT_DIR}/dist/." "${PKG_DIR}${OPT}/web/"

# ---------- Node-Server + Bridge ----------
cp "${SCRIPT_DIR}/scripts/iptv-server.mjs" "${PKG_DIR}${OPT}/server/"
# Der Server erwartet die Bridge unter <root>/scripts/linux-bridge.js
mkdir -p "${PKG_DIR}${OPT}/server/scripts"
mv "${PKG_DIR}${OPT}/server/iptv-server.mjs" "${PKG_DIR}${OPT}/server/scripts/iptv-server.mjs"
if [[ -f "${SCRIPT_DIR}/scripts/linux-bridge.js" ]]; then
  # die aktual reparierte Version (serverBase-Logik + Remote-Pulse) liegt in scripts/
  cp "${SCRIPT_DIR}/scripts/linux-bridge.js" "${PKG_DIR}${OPT}/server/scripts/linux-bridge.js"
elif [[ -f "${SCRIPT_DIR}/linux-bridge/linux-bridge.js" ]]; then
  cp "${SCRIPT_DIR}/linux-bridge/linux-bridge.js" "${PKG_DIR}${OPT}/server/scripts/linux-bridge.js"
else
  echo "FEHLER: linux-bridge.js nicht gefunden" >&2; exit 1
fi
# Bridge immer zusätzlich nach <root>/scripts/ (der Server liest sie relativ zu --root):
mkdir -p "${PKG_DIR}${OPT}/web/scripts"
cp "${PKG_DIR}${OPT}/server/scripts/linux-bridge.js" "${PKG_DIR}${OPT}/web/scripts/linux-bridge.js"
BRIDGE_IN_PKG="${PKG_DIR}${OPT}/server/scripts/linux-bridge.js"
SERVER_IN_PKG="${PKG_DIR}${OPT}/server/scripts/iptv-server.mjs"
# Server soll nur Node-Core-Importe haben → keine node_modules nötig. Prüfen:
if grep -E "^[[:space:]]*(import|export)[^;]*from ['\"]" "$SERVER_IN_PKG" \
     | grep -vE "from ['\"](\.|node:)" >/dev/null 2>&1; then
  echo "WARNUNG: Server importiert Nicht-Core-Module — node_modules müssen mit ins Paket" >&2
fi

# ---------- Icon ----------
ICON_SRC="${SCRIPT_DIR}/icon-source.png"
if [[ -f "$ICON_SRC" ]]; then
  if command -v convert >/dev/null 2>&1; then
    convert "$ICON_SRC" -resize 256x256 "${PKG_DIR}/usr/share/icons/hicolor/256x256/apps/${APP_ID}.png"
  elif command -v python3 >/dev/null 2>&1; then
    python3 - "$ICON_SRC" "${PKG_DIR}/usr/share/icons/hicolor/256x256/apps/${APP_ID}.png" <<'PY'
import sys
try:
    from PIL import Image
    img = Image.open(sys.argv[1]); img.thumbnail((256, 256)); img.save(sys.argv[2])
except Exception as e:
    sys.exit(1)
PY
  else
    cp "$ICON_SRC" "${PKG_DIR}/usr/share/icons/hicolor/256x256/apps/${APP_ID}.png"
  fi
fi

# ---------- Launcher-Skript (Kiosk-Browser + Server) ----------
cat > "${PKG_DIR}/usr/bin/${PKG_NAME}-linux" <<EOF
#!/usr/bin/env bash
# ${PKG_NAME}-linux — startet den IPTV-Server (falls noch nicht aktiv) und
# öffnet die App in einem Browser im Kiosk-Modus. Resourcenschonende
# Alternative zu Electron.
set -u
APP_ID="${APP_ID}"
OPT_DIR="${OPT}"
PORT="\${IPTV_PORT:-8080}"
DATA_DIR="\${IPTV_DATA_DIR:-\$HOME/.local/share/iptv-player}"
LOG_DIR="\$HOME/.local/share/iptv-player/logs"
PIDFILE="\$DATA_DIR/server.pid"
mkdir -p "\$DATA_DIR" "\$LOG_DIR"

is_running() { curl -sf -m 2 "http://127.0.0.1:\${PORT}/native/server/status" >/dev/null 2>&1; }

# HTTP-Check auch ohne curl (node ist dank Depends immer vorhanden)
if ! command -v curl >/dev/null 2>&1; then
  is_running() {
    node -e "fetch('http://127.0.0.1:'+process.argv[1]+'/native/server/status').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" "\$PORT" 2>/dev/null
  }
fi

find_browser() {
  for b in google-chrome google-chrome-stable chromium chromium-browser microsoft-edge brave-browser firefox; do
    command -v "\$b" >/dev/null 2>&1 && { echo "\$b"; return; }
  done
}

start_server() {
  is_running && return 0
  nohup node "\${OPT_DIR}/server/scripts/iptv-server.mjs" \\
    --port "\$PORT" --data "\$DATA_DIR" --root "\${OPT_DIR}/web" \\
    >>"\${LOG_DIR}/server.log" 2>&1 &
  echo \$! > "\$PIDFILE"
  # bis zu 10 s auf Bereitschaft warten
  for i in \$(seq 1 50); do is_running && return 0; sleep 0.2; done
  echo "IPTV-Server konnte nicht starten — siehe \${LOG_DIR}/server.log" >&2
  return 1
}

stop_server_if_ours() {
  # Nur beenden, wenn wir es waren (PID-Datei vorhanden und Prozess gehört uns)
  if [[ -f "\$PIDFILE" ]]; then
    pid=\$(cat "\$PIDFILE" 2>/dev/null || true)
    if [[ -n "\$pid" ]] && kill -0 "\$pid" 2>/dev/null; then kill "\$pid" 2>/dev/null || true; fi
    rm -f "\$PIDFILE"
  fi
}

BROWSER="\${IPTV_BROWSER:-\$(find_browser)}"
if [[ -z "\$BROWSER" ]]; then
  zenity --error --text="Kein unterstützter Browser gefunden (Chrome, Chromium, Edge, Brave oder Firefox)." 2>/dev/null \\
    || notify-send "IPTV Player" "Kein Browser gefunden — bitte Chrome/Chromium/Firefox installieren." 2>/dev/null \\
    || echo "Kein Browser gefunden." >&2
  exit 1
fi

# Kiosk-Modus: bei Autostart (--autostart vom .desktop) direkt fullscreen;
# sonst normales Fenster mit dezenter UI, damit mehrere Tabs/Extensions gehen.
KIOSK_MODE=0
[[ "\$1" == "--autostart" || "\${IPTV_KIOSK:-0}" == "1" ]] && KIOSK_MODE=1

start_server || exit 1

PROFILE="\$DATA_DIR/browser-profile"
mkdir -p "\$PROFILE"

case "\$BROWSER" in
  firefox)
    ARGS=(--private-window --width 1280 --height 720 "http://127.0.0.1:\$PORT/")
    [[ "\$KIOSK_MODE" == 1 ]] && ARGS=(--kiosk "http://127.0.0.1:\$PORT/")
    ;;
  *)
    COMMON=(--user-data-dir="\$PROFILE" --no-first-run --no-default-browser-check --disable-session-crashed-bubble)
    if [[ "\$KIOSK_MODE" == 1 ]]; then
      ARGS=(\${COMMON[@]} --kiosk --autoplay-policy=no-user-gesture-required "http://127.0.0.1:\$PORT/")
    else
      ARGS=(\${COMMON[@]} --app="http://127.0.0.1:\$PORT/" --window-size=1280,800 --autoplay-policy=no-user-gesture-required)
    fi
    ;;
esac

if [[ "\$KIOSK_MODE" == 1 ]]; then
  # Kiosk: Browser läuft im Vordergrund; beim Beenden Server aufräumen
  "\$BROWSER" "\${ARGS[@]}"
  stop_server_if_ours
else
  # App-Fenster: im Hintergrund starten, Launcher sofort beenden
  nohup "\$BROWSER" "\${ARGS[@]}" >/dev/null 2>&1 &
  disown 2>/dev/null || true
fi
EOF
chmod 755 "${PKG_DIR}/usr/bin/${PKG_NAME}-linux"

# ---------- KDEnstop-Eintrag ----------
cat > "${PKG_DIR}/usr/share/applications/${APP_ID}.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=IPTV Player
Comment=${DESCRIPTION}
Exec=/usr/bin/${PKG_NAME}-linux
Terminal=false
Icon=${APP_ID}
Categories=AudioVideo;TV;Network;
Keywords=iptv;tv;streaming;m3u;epg;
StartupWMClass=iptv-player
EOF

# ---------- Autostart-Variante (Kiosk) ----------
cat > "${PKG_DIR}/usr/share/applications/${APP_ID}-autostart.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=IPTV Player (Kiosk)
Comment=IPTV Player im Kiosk-Modus (Autostart)
Exec=/usr/bin/${PKG_NAME}-linux --autostart
Terminal=false
Icon=${APP_ID}
Categories=AudioVideo;TV;Network;
NoDisplay=true
X-GNOME-Autostart-enabled=false
EOF

# ---------- DEBIAN-Steuerdateien ----------
INSTALLED_SIZE=$(du -sk "$PKG_DIR" | cut -f1)
cat > "${PKG_DIR}/DEBIAN/control" <<EOF
Package: ${PKG_NAME}
Version: ${VERSION}
Architecture: ${ARCH}
Maintainer: ${MAINTAINER}
Depends: nodejs (>= 18), xdg-utils
Recommends: chromium | chromium-browser | google-chrome-stable | firefox-esr | firefox, libmpv1 | mpv
Suggests: ffmpeg
Installed-Size: ${INSTALLED_SIZE}
Section: utils
Priority: optional
Homepage: https://github.com/iptvplayer
Description: ${DESCRIPTION}
 Der IPTV Player läuft als lokaler Node-Server (Port 8080) mit Web-Oberfläche;
 ein im App-/Kiosk-Modus gestarteter Browser dient als Fenster. Das ist
 deutlich ressourcenschonender als ein Electron-Paket und nutzt vorhandene
 Systembibliotheken. Features: M3U/M3U8-Playlists, EPG (XMLTV), Remote-Web-
 Pult, Datei-Upload, mpv/ffplay-Wiedergabe, XDG-Autostart.
EOF

cat > "${PKG_DIR}/DEBIAN/conffiles" <<'EOF'
EOF

# postinst: Desktop-Datenbank aktualisieren, ausführbare Bits sichern
cat > "${PKG_DIR}/DEBIAN/postinst" <<EOF
#!/bin/sh
set -e
chmod 755 /usr/bin/${PKG_NAME}-linux
command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database /usr/share/applications || true
command -v gtk-update-icon-cache >/dev/null 2>&1 && gtk-update-icon-cache -q /usr/share/icons/hicolor || true
exit 0
EOF
chmod 755 "${PKG_DIR}/DEBIAN/postinst"

cat > "${PKG_DIR}/DEBIAN/prerm" <<EOF
#!/bin/sh
set -e
# laufenden Server des Pakets beenden (nur PID aus unserer Datei)
for d in \$HOME /home/*; do
  pf="\$d/.local/share/iptv-player/server.pid"
  if [ -f "\$pf" ]; then
    pid=\$(cat "\$pf" 2>/dev/null || true)
    [ -n "\$pid" ] && kill "\$pid" 2>/dev/null || true
    rm -f "\$pf"
  fi
done
exit 0
EOF
chmod 755 "${PKG_DIR}/DEBIAN/prerm"

# ---------- .deb bauen ----------
mkdir -p "$OUT_DIR"
rm -f "$DEB_FILE"
dpkg-deb --build --root-owner-group "$PKG_DIR" "$DEB_FILE"

echo "==> Fertig: $DEB_FILE"
dpkg-deb --info "$DEB_FILE" | sed -n '1,20p'
echo
echo "Installation:  sudo dpkg -i $(basename "$DEB_FILE") && sudo apt -f install"
echo "Start (Menü):  IPTV Player   |   Terminal: iptv-player-linux"
