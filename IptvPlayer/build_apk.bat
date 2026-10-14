@echo off
chcp 65001 >nul
cd /d D:\capacitor\iptvPlayer\android
call gradlew.bat assembleDebug --console=plain
if errorlevel 1 ( echo. & echo СБОРКА НЕ УДАЛАСЬ & pause & exit /b 1 )
copy /y app\build\outputs\apk\debug\app-debug.apk D:\capacitor\iptvPlayer\IPTV-Player-debug.apk
echo.
echo ГОТОВО: D:\capacitor\iptvPlayer\IPTV-Player-debug.apk
pause