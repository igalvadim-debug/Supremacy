@echo off
chcp 65001 >nul
rem Sync web assets + regenerate android/capacitor-cordova-android-plugins (needs node_modules).
cd /d D:\capacitor\Supremacy\IptvPlayer
call npm run sync
if errorlevel 1 ( echo. & echo SYNC НЕ УДАЛСЯ & pause & exit /b 1 )
cd /d D:\capacitor\Supremacy\IptvPlayer\android
call gradlew.bat assembleDebug --console=plain
if errorlevel 1 ( echo. & echo СБОРКА НЕ УДАЛАСЬ & pause & exit /b 1 )
copy /y app\build\outputs\apk\debug\app-debug.apk D:\capacitor\Supremacy\IptvPlayer\IPTV-Player-debug.apk
echo.
echo ГОТОВО: D:\capacitor\Supremacy\IptvPlayer\IPTV-Player-debug.apk
pause