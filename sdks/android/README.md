# Pushlane for Android

This Kotlin JVM library uses `HttpURLConnection` and can be included in an Android application. It targets Java 17 and does not depend on Firebase or an Android permission API. Add `sdks/android` as a composite Gradle build. There is no published Maven artifact yet.

```kotlin
// settings.gradle.kts in your Android project
includeBuild("../pushlane/sdks/android")
```

```kotlin
// app/build.gradle.kts
dependencies {
    implementation("com.pushlane:pushlane-android:0.1.0")
}
```

Declare `android.permission.INTERNET`. Request `POST_NOTIFICATIONS` on Android 13 and later from an explicit user action. Create a notification channel before receiving notifications. Keep these app decisions outside registration.

Persist one installation ID in app-private storage.

```kotlin
val preferences = context.getSharedPreferences("pushlane", Context.MODE_PRIVATE)
val installationId = preferences.getString("installation-id", null)
    ?: UUID.randomUUID().toString().also {
        check(preferences.edit().putString("installation-id", it).commit())
    }

val push = Pushlane("https://push.example.com", installationId)
```

Your authenticated backend calls `POST /v1/registration-tokens` with the signed-in user's ID and this installation ID. Return only the resulting installation token to the app. A project API key must never appear in an APK.

Obtain the current FCM token after sign-in and register on a background dispatcher.

```kotlin
withContext(Dispatchers.IO) {
    push.register(fcmToken, installationTokenFromYourBackend)
}
```

In `FirebaseMessagingService.onNewToken`, schedule background registration with the current signed-in user's backend. Obtain a fresh installation token after its one-hour expiry. If no user is signed in, save the FCM token locally and register after sign-in.

Registration and logout are synchronized on each client. Keep one client per installation and wait for lifecycle operations before changing the authenticated account.

Before clearing the app's login state, revoke the server binding.

```kotlin
withContext(Dispatchers.IO) {
    push.unregister()
}
```

After an app restart, obtain a fresh token and pass it to `unregister(registrationToken)`. Registration expiry does not prevent revocation of that session. Await successful revocation before reporting logout complete. Switching accounts requires a new registration token and registration for the new user. A provider request already authorized before logout cannot be recalled.

Pushlane sends title, body, image, and click URL through FCM. Background notification presentation depends on Firebase and the app's notification configuration. Handle foreground messages in `onMessageReceived`. For foreground image presentation, download the HTTPS image with a bounded timeout and size limit on a background dispatcher, then use `NotificationCompat.BigPictureStyle`. Handle the `url` data field on click only after checking that it is an allowed HTTPS destination for your app.

Run `gradle test` with Gradle 8.14 and JDK 17 to compile and test this package. Without a local Java installation, run the same checks from this directory with Docker.

```sh
docker run --rm -v "$PWD:/workspace" -w /workspace gradle:8.14-jdk17 gradle test --no-daemon
```

These JVM tests verify registration requests. They do not establish notification delivery or presentation on a physical Android device.
