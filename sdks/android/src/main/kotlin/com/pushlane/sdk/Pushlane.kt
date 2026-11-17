package com.pushlane.sdk

import java.io.IOException
import java.net.HttpURLConnection
import java.net.URI
import java.util.UUID
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/** An API failure whose status can distinguish expired credentials from server failures. */
class PushlaneException(val status: Int) : IOException("Pushlane returned HTTP $status.")

/**
 * Registers an Android installation without handling app authentication or notification permission.
 *
 * All network methods block. Call them on a background executor or Dispatchers.IO.
 * Persist installationId in app-private storage and reuse it across launches.
 */
class Pushlane(
    baseUrl: String,
    val installationId: String,
) {
    private val baseUri = URI(baseUrl)

    @Volatile
    private var registrationToken: String? = null

    init {
        UUID.fromString(installationId)

        val local = baseUri.host in setOf("localhost", "127.0.0.1", "::1", "[::1]")

        require(baseUri.scheme == "https" || (baseUri.scheme == "http" && local)) {
            "Pushlane requires HTTPS except on localhost."
        }

        require(baseUri.rawUserInfo == null && baseUri.rawQuery == null && baseUri.rawFragment == null) {
            "The API URL must not contain credentials, a query, or a fragment."
        }
    }

    /**
     * Registers a current FCM token with an installation session issued by your authenticated backend.
     * Call again when FirebaseMessagingService.onNewToken supplies a replacement.
     */
    @Synchronized
    fun register(fcmToken: String, registrationToken: String) {
        require(fcmToken.isNotBlank()) { "An FCM token is required." }

        val body = buildJsonObject {
            put("kind", "fcm")
            put("token", fcmToken)
        }.toString()

        request("PUT", registrationToken, body)

        this.registrationToken = registrationToken
    }

    /**
     * Revokes the server binding before the app clears its authenticated session.
     * Supply a fresh token after an app restart if no session token remains in memory.
     */
    @Synchronized
    fun unregister(registrationToken: String? = null) {
        val token = registrationToken ?: this.registrationToken
            ?: throw IllegalStateException("An installation registration token is required.")

        request("DELETE", token, null)

        if (this.registrationToken == token) this.registrationToken = null
    }

    private fun request(method: String, token: String, body: String?) {
        val url = baseUri.resolve("/v1/installations/$installationId").toURL()
        val connection = url.openConnection() as HttpURLConnection

        try {
            connection.requestMethod = method
            connection.instanceFollowRedirects = false
            connection.connectTimeout = 15_000
            connection.readTimeout = 15_000
            connection.setRequestProperty("Authorization", "Bearer $token")
            connection.setRequestProperty("Accept", "application/json")

            if (body != null) {
                val bytes = body.toByteArray(Charsets.UTF_8)

                connection.doOutput = true
                connection.setRequestProperty("Content-Type", "application/json")
                connection.setFixedLengthStreamingMode(bytes.size)
                connection.outputStream.use { it.write(bytes) }
            }

            val status = connection.responseCode

            if (status !in 200..299) {
                connection.errorStream?.close()
                throw PushlaneException(status)
            }

            connection.inputStream.close()
        } finally {
            connection.disconnect()
        }
    }
}
