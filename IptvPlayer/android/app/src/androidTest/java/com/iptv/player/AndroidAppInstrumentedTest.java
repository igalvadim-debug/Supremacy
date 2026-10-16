package com.iptv.player;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertThrows;
import static org.junit.Assert.assertTrue;

import android.content.Context;
import android.content.Intent;
import android.content.pm.ActivityInfo;
import android.content.pm.PackageManager;
import android.content.pm.ProviderInfo;
import android.content.pm.ResolveInfo;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;
import androidx.core.content.FileProvider;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileNotFoundException;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;

/** Integration checks for the installed manifest and Android's FileProvider. */
@RunWith(AndroidJUnit4.class)
public class AndroidAppInstrumentedTest {

    private Context context;

    @Before
    public void useTargetApplication() {
        context = InstrumentationRegistry.getInstrumentation().getTargetContext();
    }

    @Test
    public void installedApplicationUsesThePlayerPackage() {
        assertEquals("com.iptv.player", context.getPackageName());
    }

    @Test
    public void installedApplicationResolvesItsLabelAndLauncherIcon() throws Exception {
        PackageManager packages = context.getPackageManager();
        assertEquals("IPTV Player", packages.getApplicationLabel(context.getApplicationInfo()).toString());
        assertTrue("The manifest must declare a launcher icon", context.getApplicationInfo().icon != 0);
        assertNotNull(packages.getApplicationIcon(context.getPackageName()));
    }

    @Test
    public void launcherResolvesToTheExportedSingleTaskPlayerActivity() {
        Intent launcher = new Intent(Intent.ACTION_MAIN)
            .addCategory(Intent.CATEGORY_LAUNCHER)
            .setPackage(context.getPackageName());
        ResolveInfo resolved = context.getPackageManager().resolveActivity(launcher, 0);

        assertNotNull("The installed app must be launchable", resolved);
        assertEquals(MainActivity.class.getName(), resolved.activityInfo.name);
        assertTrue(resolved.activityInfo.exported);
        assertEquals(ActivityInfo.LAUNCH_SINGLE_TASK, resolved.activityInfo.launchMode);
    }

    @Test
    public void streamingHasInternetPermissionAtInstallTime() {
        assertEquals(PackageManager.PERMISSION_GRANTED, context.getPackageManager()
            .checkPermission(android.Manifest.permission.INTERNET, context.getPackageName()));
    }

    @Test
    public void installedFileProviderIsPrivateAndSupportsTemporaryUriGrants() {
        ProviderInfo provider = context.getPackageManager()
            .resolveContentProvider(context.getPackageName() + ".fileprovider", PackageManager.GET_META_DATA);

        assertNotNull(provider);
        assertEquals(FileProvider.class.getName(), provider.name);
        assertFalse(provider.exported);
        assertTrue(provider.grantUriPermissions);
        assertNotNull(provider.metaData);
        assertTrue(provider.metaData.getInt("android.support.FILE_PROVIDER_PATHS") != 0);
    }

    @Test
    public void cacheFileWithSpacesAndUnicodeRoundTripsThroughAContentUri() throws Exception {
        File file = File.createTempFile("playlist space тест ", ".m3u", context.getCacheDir());
        byte[] playlist = "#EXTM3U\n#EXTINF:-1,Канал\nhttps://example.invalid/live.m3u8\n".getBytes(StandardCharsets.UTF_8);
        try {
            try (FileOutputStream output = new FileOutputStream(file)) {
                output.write(playlist);
            }
            Uri uri = FileProvider.getUriForFile(context, context.getPackageName() + ".fileprovider", file);

            assertEquals("content", uri.getScheme());
            assertEquals(context.getPackageName() + ".fileprovider", uri.getAuthority());
            assertEquals(file.getName(), uri.getLastPathSegment());
            try (InputStream input = context.getContentResolver().openInputStream(uri)) {
                assertNotNull(input);
                ByteArrayOutputStream output = new ByteArrayOutputStream();
                byte[] buffer = new byte[256];
                int count;
                while ((count = input.read(buffer)) != -1) {
                    output.write(buffer, 0, count);
                }
                assertArrayEquals(playlist, output.toByteArray());
            }
        } finally {
            assertTrue("Remove the test playlist", file.delete());
        }
    }

    @Test
    public void emptyCacheFileWithReservedCharactersReportsItsNameAndZeroSize() throws Exception {
        File file = File.createTempFile("playlist %2F #?+ тест ", ".m3u", context.getCacheDir());
        try {
            Uri uri = FileProvider.getUriForFile(context, context.getPackageName() + ".fileprovider", file);
            assertEquals("Reserved characters must stay inside the filename", file.getName(), uri.getLastPathSegment());
            assertNull(uri.getQuery());
            assertNull(uri.getFragment());

            String[] projection = {OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE};
            try (Cursor cursor = context.getContentResolver().query(uri, projection, null, null, null)) {
                assertNotNull(cursor);
                assertTrue(cursor.moveToFirst());
                assertEquals(file.getName(), cursor.getString(cursor.getColumnIndexOrThrow(OpenableColumns.DISPLAY_NAME)));
                assertEquals(0L, cursor.getLong(cursor.getColumnIndexOrThrow(OpenableColumns.SIZE)));
                assertFalse("One file must produce one metadata row", cursor.moveToNext());
            }
            try (InputStream input = context.getContentResolver().openInputStream(uri)) {
                assertNotNull(input);
                assertEquals("An empty shared file must be readable", -1, input.read());
            }
        } finally {
            assertTrue("Remove the empty test playlist", file.delete());
        }
    }

    @Test
    public void canonicalPathWithinCacheResolvesToTheSameContentUri() throws Exception {
        File file = File.createTempFile("canonical-playlist-", ".m3u", context.getCacheDir());
        try {
            File alias = new File(context.getCacheDir(), "./" + file.getName());
            String authority = context.getPackageName() + ".fileprovider";
            assertEquals(FileProvider.getUriForFile(context, authority, file),
                FileProvider.getUriForFile(context, authority, alias));
        } finally {
            assertTrue("Remove the canonical path test file", file.delete());
        }
    }

    @Test
    public void deletingACacheFileMakesItsPreviouslyIssuedUriUnreadable() throws Exception {
        File file = File.createTempFile("deleted-playlist-", ".m3u", context.getCacheDir());
        try {
            Uri uri = FileProvider.getUriForFile(context, context.getPackageName() + ".fileprovider", file);
            assertTrue("Delete the shared file before trying its URI", file.delete());
            assertThrows(FileNotFoundException.class, () -> {
                try (InputStream ignored = context.getContentResolver().openInputStream(uri)) {
                    // Close the stream if a regression unexpectedly allows it to open.
                }
            });
        } finally {
            if (file.exists()) {
                assertTrue("Remove the deleted URI test file", file.delete());
            }
        }
    }

    @Test
    public void encodedContentUriTraversalCannotReadPrivateApplicationFiles() throws Exception {
        File file = File.createTempFile("uri-private-playlist-", ".m3u", context.getFilesDir());
        try {
            // Exercise incoming URIs as well as the getUriForFile checks below.
            Uri traversal = new Uri.Builder()
                .scheme("content")
                .authority(context.getPackageName() + ".fileprovider")
                .appendPath("my_cache_images")
                .appendPath("../files/" + file.getName())
                .build();
            assertThrows(SecurityException.class, () -> {
                try (InputStream ignored = context.getContentResolver().openInputStream(traversal)) {
                    // Close the stream if private storage is unexpectedly exposed.
                }
            });
        } finally {
            assertTrue("Remove the URI traversal test file", file.delete());
        }
    }

    @Test
    public void privateApplicationFilesCannotBeShared() throws Exception {
        File file = File.createTempFile("private-playlist-", ".m3u", context.getFilesDir());
        try {
            assertThrows(IllegalArgumentException.class, () ->
                FileProvider.getUriForFile(context, context.getPackageName() + ".fileprovider", file));
        } finally {
            assertTrue("Remove the private test file", file.delete());
        }
    }

    @Test
    public void cacheTraversalCannotEscapeIntoPrivateApplicationFiles() throws Exception {
        File file = File.createTempFile("private-playlist-", ".m3u", context.getFilesDir());
        File traversal = new File(context.getCacheDir(), "../files/" + file.getName());
        try {
            assertEquals("The traversal must target the private test file", file.getCanonicalFile(), traversal.getCanonicalFile());
            assertThrows(IllegalArgumentException.class, () ->
                FileProvider.getUriForFile(context, context.getPackageName() + ".fileprovider", traversal));
        } finally {
            assertTrue("Remove the private test file", file.delete());
        }
    }
}
