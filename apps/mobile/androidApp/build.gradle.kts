plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.roborazzi)
}

// versionName follows the desktop app (root package.json); versionCode = major·10000 + minor·100 + patch.
val appVersion: String = Regex("\"version\"\\s*:\\s*\"([^\"]+)\"")
    .find(rootDir.resolve("../../package.json").readText())!!.groupValues[1]
val appVersionCode: Int = appVersion.substringBefore('-').split('.').map { it.toInt() }.let { (ma, mi, pa) -> ma * 10000 + mi * 100 + pa }

// Release signing comes from the environment (CI restores the keystore from secrets).
val releaseKeystore: String? = System.getenv("ANDROID_KEYSTORE_PATH")?.takeIf { it.isNotBlank() }
val requireReleaseSigning = System.getenv("PI_REQUIRE_RELEASE_SIGNING") == "1"
if (requireReleaseSigning && releaseKeystore == null) error("PI_REQUIRE_RELEASE_SIGNING=1 but ANDROID_KEYSTORE_PATH is not set")

android {
    namespace = "dev.pi.remote"
    compileSdk {
        version = release(37) { minorApiLevel = 2 }
    }

    defaultConfig {
        applicationId = "dev.pi.remote"
        minSdk = 28
        targetSdk = 36
        versionCode = appVersionCode
        versionName = appVersion
        // Release ships arm64 only; `-Ppi.abis=x86_64` builds an emulator-testable variant.
        ndk { abiFilters += (providers.gradleProperty("pi.abis").orNull ?: "arm64-v8a").split(",") }
    }

    signingConfigs {
        if (releaseKeystore != null) {
            create("release") {
                storeFile = file(releaseKeystore)
                storePassword = System.getenv("ANDROID_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("ANDROID_KEY_ALIAS")
                keyPassword = System.getenv("ANDROID_KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            // Without ANDROID_KEYSTORE_PATH (local builds) the release APK is signed with the debug key.
            signingConfig = signingConfigs.getByName(if (releaseKeystore != null) "release" else "debug")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures { compose = true }
    // AndroidMath ships three OpenType math fonts (~1.8MB); we typeset with Latin Modern only.
    androidResources { ignoreAssetsPatterns += listOf("xits-math.otf", "texgyretermes-math.otf") }

    testOptions {
        unitTests {
            isIncludeAndroidResources = true
            all { it.systemProperty("robolectric.pixelCopyRenderMode", "hardware") }
        }
    }

    packaging {
        resources.excludes += setOf("META-INF/{AL2.0,LGPL2.1}", "META-INF/versions/9/OSGI-INF/MANIFEST.MF", "META-INF/INDEX.LIST", "META-INF/io.netty.versions.properties", "DebugProbesKt.bin")
    }
}

dependencies {
    implementation(project(":shared"))
    implementation(platform(libs.compose.bom))
    implementation(libs.compose.ui)
    implementation(libs.compose.foundation)
    implementation(libs.compose.material3)
    implementation(libs.compose.ui.tooling.preview)
    implementation(libs.activity.compose)
    implementation(libs.navigation.compose)
    implementation(libs.lifecycle.viewmodel.compose)
    implementation(libs.lifecycle.runtime.compose)
    implementation(libs.lifecycle.process)
    implementation(libs.core.ktx)
    implementation(libs.coroutines.android)
    implementation(libs.serialization.json)
    implementation(libs.markdown.m3)
    implementation(libs.markdown.code)
    implementation(libs.zxing.embedded)
    implementation(libs.profileinstaller)
    // Its POM leaks appcompat and test artifacts as runtime deps; the library itself only needs android.*.
    implementation(libs.androidmath) {
        exclude(group = "androidx.appcompat")
        exclude(group = "androidx.test")
        exclude(group = "junit")
        exclude(group = "com.github.jitpack")
    }
    debugImplementation(libs.compose.ui.tooling)

    testImplementation(libs.junit)
    testImplementation(libs.robolectric)
    testImplementation(libs.roborazzi)
    testImplementation(libs.roborazzi.compose)
    testImplementation(libs.androidx.test.junit)
    testImplementation(platform(libs.compose.bom))
    testImplementation(libs.compose.ui.test.junit4)
    debugImplementation(libs.compose.ui.test.manifest)
}
