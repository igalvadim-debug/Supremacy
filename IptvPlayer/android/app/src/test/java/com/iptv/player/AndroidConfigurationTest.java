package com.iptv.player;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

import com.getcapacitor.BridgeActivity;
import java.io.File;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;
import javax.xml.parsers.DocumentBuilderFactory;
import org.junit.Before;
import org.junit.Test;
import org.w3c.dom.Element;
import org.w3c.dom.Node;
import org.w3c.dom.NodeList;

/** Tests the Android shell's configuration without starting an Android runtime. */
public class AndroidConfigurationTest {

    private static final String ANDROID = "http://schemas.android.com/apk/res/android";
    private static final String[] DENSITIES = {"mdpi", "hdpi", "xhdpi", "xxhdpi", "xxxhdpi"};
    private Element manifest;

    @Before
    public void readManifest() throws Exception {
        // Gradle runs local unit tests from the app module directory.
        manifest = readXml("AndroidManifest.xml");
    }

    @Test
    public void mainActivityUsesTheCapacitorBridge() {
        assertEquals(BridgeActivity.class, MainActivity.class.getSuperclass());
    }

    @Test
    public void launcherExposesMainActivityWithMainAndLauncherInTheSameFilter() {
        Element activity = androidElement(manifest, "activity", ".MainActivity");
        assertEquals("true", androidAttribute(activity, "exported"));

        NodeList filters = activity.getElementsByTagName("intent-filter");
        boolean hasLauncher = false;
        for (int i = 0; i < filters.getLength(); i++) {
            Element filter = (Element) filters.item(i);
            hasLauncher |= findNamedElement(filter, "action", "android.intent.action.MAIN", ANDROID) != null
                && findNamedElement(filter, "category", "android.intent.category.LAUNCHER", ANDROID) != null;
        }
        assertTrue("MAIN and LAUNCHER must belong to the same intent filter", hasLauncher);
    }

    @Test
    public void mainActivityReusesItsTaskForSubsequentLaunches() {
        assertEquals("singleTask", androidAttribute(androidElement(manifest, "activity", ".MainActivity"), "launchMode"));
    }

    @Test
    public void configurationChangesDoNotRecreateThePlayer() {
        Set<String> handledChanges = new HashSet<>(Arrays.asList(
            androidAttribute(androidElement(manifest, "activity", ".MainActivity"), "configChanges").split("\\|")
        ));
        for (String change : Arrays.asList("orientation", "screenSize", "smallestScreenSize",
                "screenLayout", "uiMode", "density", "locale", "keyboard", "keyboardHidden", "navigation")) {
            assertTrue("The player must handle " + change, handledChanges.contains(change));
        }
    }

    @Test
    public void internetAccessIsNotLimitedToOlderAndroidVersions() {
        Element permission = androidElement(manifest, "uses-permission", "android.permission.INTERNET");
        assertFalse("Streaming must work above the minimum SDK", permission.hasAttributeNS(ANDROID, "maxSdkVersion"));
    }

    @Test
    public void fileProviderIsPrivateAndUsesAnApplicationScopedAuthority() {
        Element provider = androidElement(manifest, "provider", "androidx.core.content.FileProvider");
        assertEquals("${applicationId}.fileprovider", androidAttribute(provider, "authorities"));
        assertEquals("false", androidAttribute(provider, "exported"));
        assertEquals("true", androidAttribute(provider, "grantUriPermissions"));
    }

    @Test
    public void fileProviderMetadataResolvesToExternalAndCacheRoots() throws Exception {
        Element metadata = androidElement(androidElement(manifest, "provider", "androidx.core.content.FileProvider"),
            "meta-data", "android.support.FILE_PROVIDER_PATHS");
        String resource = androidAttribute(metadata, "resource");
        assertTrue("FileProvider paths must be an XML resource", resource.startsWith("@xml/"));
        Element paths = readXml("res/xml/" + resource.substring("@xml/".length()) + ".xml");
        assertEquals("paths", paths.getTagName());
        assertEquals(".", namedElement(paths, "external-path", "my_images").getAttribute("path"));
        assertEquals(".", namedElement(paths, "cache-path", "my_cache_images").getAttribute("path"));
    }

    @Test
    public void fileProviderDoesNotExposePrivateFilesOrTheFilesystemRoot() throws Exception {
        Element paths = readXml("res/xml/file_paths.xml");
        assertEquals(0, paths.getElementsByTagName("root-path").getLength());
        assertEquals(0, paths.getElementsByTagName("files-path").getLength());
    }

    @Test
    public void fileProviderRootsHaveUniqueUriNamesAndNoAdditionalStorageScopes() throws Exception {
        Element paths = readXml("res/xml/file_paths.xml");
        Set<String> allowedRoots = new HashSet<>(Arrays.asList("external-path", "cache-path"));
        Set<String> names = new HashSet<>();
        NodeList children = paths.getChildNodes();
        for (int i = 0; i < children.getLength(); i++) {
            Node child = children.item(i);
            if (child instanceof Element) {
                Element root = (Element) child;
                assertTrue("Unexpected shared storage scope: " + root.getTagName(), allowedRoots.contains(root.getTagName()));
                String name = root.getAttribute("name");
                assertFalse("Shared roots need a URI name", name.trim().isEmpty());
                assertTrue("Duplicate root names overwrite FileProvider mappings: " + name, names.add(name));
            }
        }
    }

    @Test
    public void applicationAndActivityLabelsResolveToThePlayerName() throws Exception {
        Element strings = readXml("res/values/strings.xml");
        for (Element component : Arrays.asList(onlyElement(manifest, "application"), androidElement(manifest, "activity", ".MainActivity"))) {
            String label = androidAttribute(component, "label");
            assertTrue("App labels must use a string resource", label.startsWith("@string/"));
            assertEquals("IPTV Player", namedElement(strings, "string", label.substring("@string/".length())).getTextContent());
        }
        assertEquals(MainActivity.class.getPackage().getName(), namedElement(strings, "string", "package_name").getTextContent());
    }

    @Test
    public void launchThemeResolvesToASplashScreenWithAnExistingBackground() throws Exception {
        String theme = androidAttribute(androidElement(manifest, "activity", ".MainActivity"), "theme");
        assertTrue(theme.startsWith("@style/"));
        Element style = namedElement(readXml("res/values/styles.xml"), "style", theme.substring("@style/".length()));
        assertEquals("Theme.SplashScreen", style.getAttribute("parent"));
        assertEquals("@drawable/splash", namedElement(style, "item", "android:background").getTextContent());
        assertTrue("A default splash is needed outside orientation-specific qualifiers", new File("src/main/res/drawable/splash.png").isFile());
    }

    @Test
    public void launcherIconsHaveRasterFallbacksForAndroidBeforeAdaptiveIcons() {
        Element application = onlyElement(manifest, "application");
        for (String attribute : Arrays.asList("icon", "roundIcon")) {
            String reference = androidAttribute(application, attribute);
            assertTrue("Launcher icons must resolve to mipmap resources", reference.startsWith("@mipmap/"));
            assertDensityBitmapsExist("mipmap", reference.substring("@mipmap/".length()));
        }
    }

    @Test
    public void adaptiveLauncherIconsResolveTheirBackgroundAndForeground() throws Exception {
        Element application = onlyElement(manifest, "application");
        for (String attribute : Arrays.asList("icon", "roundIcon")) {
            String reference = androidAttribute(application, attribute);
            assertTrue(reference.startsWith("@mipmap/"));
            Element icon = readXml("res/mipmap-anydpi-v26/" + reference.substring("@mipmap/".length()) + ".xml");
            assertEquals("adaptive-icon", icon.getTagName());

            String background = androidAttribute(onlyElement(icon, "background"), "drawable");
            assertTrue("Adaptive icons need a background color", background.startsWith("@color/"));
            Element color = namedElement(readXml("res/values/ic_launcher_background.xml"), "color",
                background.substring("@color/".length()));
            assertTrue("The icon background must be a valid RGB or ARGB color",
                color.getTextContent().trim().matches("#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})"));

            String foreground = androidAttribute(onlyElement(icon, "foreground"), "drawable");
            assertTrue("Adaptive icons need a foreground image", foreground.startsWith("@mipmap/"));
            assertDensityBitmapsExist("mipmap", foreground.substring("@mipmap/".length()));
        }
    }

    @Test
    public void splashImagesExistForBothOrientationsAtEverySupportedDensity() {
        for (String orientation : Arrays.asList("port", "land")) {
            assertDensityBitmapsExist("drawable-" + orientation, "splash");
        }
    }

    @Test
    public void playerThemeHidesTheActionBarAndWindowTitle() throws Exception {
        Element style = namedElement(readXml("res/values/styles.xml"), "style", "AppTheme.NoActionBar");
        assertEquals("Theme.AppCompat.DayNight.NoActionBar", style.getAttribute("parent"));
        assertEquals("false", namedElement(style, "item", "windowActionBar").getTextContent());
        assertEquals("true", namedElement(style, "item", "windowNoTitle").getTextContent());
    }

    @Test
    public void applicationThemeResolvesToAnAppCompatTheme() throws Exception {
        String theme = androidAttribute(onlyElement(manifest, "application"), "theme");
        assertTrue(theme.startsWith("@style/"));
        Element style = namedElement(readXml("res/values/styles.xml"), "style", theme.substring("@style/".length()));
        assertTrue("The Capacitor activity needs an AppCompat application theme",
            style.getAttribute("parent").startsWith("Theme.AppCompat."));
    }

    @Test
    public void playerWebViewFillsItsLayout() throws Exception {
        Element layout = readXml("res/layout/activity_main.xml");
        Element webView = onlyElement(layout, "WebView");
        for (Element view : Arrays.asList(layout, webView)) {
            assertEquals("match_parent", androidAttribute(view, "layout_width"));
            assertEquals("match_parent", androidAttribute(view, "layout_height"));
        }
    }

    private static void assertDensityBitmapsExist(String resourceType, String name) {
        for (String density : DENSITIES) {
            File image = new File("src/main/res/" + resourceType + "-" + density, name + ".png");
            assertTrue("Missing bitmap: " + image, image.isFile());
            assertTrue("Empty bitmap: " + image, image.length() > 0);
        }
    }

    private static Element readXml(String path) throws Exception {
        DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
        factory.setNamespaceAware(true);
        factory.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
        return factory.newDocumentBuilder().parse(new File("src/main", path)).getDocumentElement();
    }

    private static String androidAttribute(Element element, String name) {
        return element.getAttributeNS(ANDROID, name);
    }

    private static Element onlyElement(Element parent, String tag) {
        NodeList matches = parent.getElementsByTagName(tag);
        assertEquals("Expected one " + tag + " in " + parent.getTagName(), 1, matches.getLength());
        return (Element) matches.item(0);
    }

    private static Element namedElement(Element parent, String tag, String name) {
        Element match = findNamedElement(parent, tag, name, null);
        assertNotNull("Missing " + tag + " named " + name, match);
        return match;
    }

    private static Element androidElement(Element parent, String tag, String name) {
        Element match = findNamedElement(parent, tag, name, ANDROID);
        assertNotNull("Missing " + tag + " named " + name, match);
        return match;
    }

    private static Element findNamedElement(Element parent, String tag, String name, String namespace) {
        NodeList elements = parent.getElementsByTagName(tag);
        Element match = null;
        for (int i = 0; i < elements.getLength(); i++) {
            Element element = (Element) elements.item(i);
            if (name.equals(element.getAttributeNS(namespace, "name"))) {
                assertTrue("Duplicate " + tag + " named " + name, match == null);
                match = element;
            }
        }
        return match;
    }
}
