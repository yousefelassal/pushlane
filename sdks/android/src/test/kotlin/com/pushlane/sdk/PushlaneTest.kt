package com.pushlane.sdk

import com.sun.net.httpserver.HttpServer
import java.net.InetSocketAddress
import java.util.Collections
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import kotlin.test.assertTrue
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

class PushlaneTest {
    @Test
    fun registrationAndLogoutUseScopedCredentialsAndCurrentEndpoint() {
        val requests = mutableListOf<Triple<String, String, String>>()
        val server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)

        server.createContext("/") { exchange ->
            requests += Triple(
                exchange.requestMethod,
                exchange.requestHeaders.getFirst("Authorization"),
                exchange.requestBody.bufferedReader().readText(),
            )

            exchange.sendResponseHeaders(204, -1)
            exchange.close()
        }

        server.start()

        try {
            val client = Pushlane(
                "http://127.0.0.1:${server.address.port}",
                "0b629250-bc86-431c-93ac-27f066ea0cfe",
            )

            client.register("fcm-device-token", "installation-token")
            client.unregister()

            assertEquals("PUT", requests[0].first)
            assertEquals("Bearer installation-token", requests[0].second)
            assertEquals("fcm", Json.parseToJsonElement(requests[0].third).jsonObject["kind"]?.jsonPrimitive?.content)
            assertEquals("fcm-device-token", Json.parseToJsonElement(requests[0].third).jsonObject["token"]?.jsonPrimitive?.content)
            assertEquals("DELETE", requests[1].first)
            assertEquals("Bearer installation-token", requests[1].second)
        } finally {
            server.stop(0)
        }
    }

    @Test
    fun overlappingRegistrationsLeaveTheCurrentTokenForLogout() {
        val requests = Collections.synchronizedList(mutableListOf<String>())
        val firstStarted = CountDownLatch(1)
        val releaseFirst = CountDownLatch(1)
        val server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        val receiverExecutor = Executors.newCachedThreadPool()
        val callers = Executors.newFixedThreadPool(2)

        server.executor = receiverExecutor
        server.createContext("/") { exchange ->
            requests += "${exchange.requestMethod} ${exchange.requestHeaders.getFirst("Authorization")}"
            exchange.requestBody.close()

            if (requests.size == 1) {
                firstStarted.countDown()
                releaseFirst.await(2, TimeUnit.SECONDS)
            }

            exchange.sendResponseHeaders(204, -1)
            exchange.close()
        }

        server.start()

        try {
            val client = Pushlane(
                "http://127.0.0.1:${server.address.port}",
                "0b629250-bc86-431c-93ac-27f066ea0cfe",
            )
            val first = callers.submit { client.register("first-fcm-token", "first-session") }

            assertTrue(firstStarted.await(2, TimeUnit.SECONDS))

            val second = callers.submit { client.register("second-fcm-token", "second-session") }

            Thread.sleep(50)

            assertEquals(listOf("PUT Bearer first-session"), requests.toList())

            releaseFirst.countDown()

            first.get(2, TimeUnit.SECONDS)
            second.get(2, TimeUnit.SECONDS)
            client.unregister("first-session")
            client.unregister()

            assertEquals(listOf("PUT Bearer first-session", "PUT Bearer second-session", "DELETE Bearer first-session", "DELETE Bearer second-session"), requests.toList())
        } finally {
            releaseFirst.countDown()
            callers.shutdownNow()
            server.stop(0)
            receiverExecutor.shutdownNow()
        }
    }

    @Test
    fun rejectsRemotePlaintextConnections() {
        assertFailsWith<IllegalArgumentException> {
            Pushlane("http://push.example.com", "0b629250-bc86-431c-93ac-27f066ea0cfe")
        }
    }
}
