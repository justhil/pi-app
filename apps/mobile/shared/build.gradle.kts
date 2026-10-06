plugins {
    alias(libs.plugins.kotlin.multiplatform)
    alias(libs.plugins.kotlin.serialization)
}

/**
 * Platform-neutral client core (protocol, sync, text) in commonMain; JVM transport and crypto in
 * jvmMain. Android consumes the jvm variant. iOS later adds its targets plus an iOS actual for
 * crypto/net without touching commonMain.
 */
kotlin {
    jvmToolchain(17)
    jvm()

    sourceSets {
        commonMain.dependencies {
            implementation(libs.coroutines.core)
            implementation(libs.serialization.json)
        }
        commonTest.dependencies {
            implementation(kotlin("test"))
            implementation(libs.coroutines.test)
        }
        jvmMain.dependencies {
            implementation(libs.ktor.client.core)
            implementation(libs.ktor.client.okhttp)
            implementation(libs.ktor.client.websockets)
            implementation(libs.bouncycastle)
        }
    }
}

// Golden fixtures shared with the TypeScript protocol package.
tasks.withType<Test>().configureEach {
    systemProperty("pi.remote.fixtures", rootDir.resolve("../../packages/shared/remote/fixtures").canonicalPath)
    System.getenv("PI_REMOTE_E2E")?.let { environment("PI_REMOTE_E2E", it) }
    System.getenv("PI_REMOTE_PAIR_FILE")?.let { environment("PI_REMOTE_PAIR_FILE", it) }
    systemProperty("pi.remote.pairFile", rootDir.resolve("../../node_modules/.cache/remote-dev/pair.json").canonicalPath)
    testLogging { events("failed"); exceptionFormat = org.gradle.api.tasks.testing.logging.TestExceptionFormat.FULL }
}
