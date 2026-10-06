# kotlinx.serialization: keep generated serializers of protocol models.
-keepattributes *Annotation*, InnerClasses
-keepclassmembers class dev.pi.remote.** { *** Companion; }
-keepclasseswithmembers class dev.pi.remote.** { kotlinx.serialization.KSerializer serializer(...); }
-keep,includedescriptorclasses class dev.pi.remote.**$$serializer { *; }
# BouncyCastle: only the lightweight API is used; JCA provider registration is not.
-dontwarn org.bouncycastle.**
# Ktor / OkHttp optional dependencies.
-dontwarn org.slf4j.**
-dontwarn org.conscrypt.**
-dontwarn org.openjsse.**
-dontwarn java.lang.management.**

# AndroidMath's FreeType JNI bridge looks classes and constructors up by name from native code
# (libmain.so → com.pvporbit.freetype.*); renaming or stripping them aborts with "mid == null".
-keep class com.pvporbit.freetype.** { *; }
-keep class com.agog.mathdisplay.render.MTFont* { *; }
