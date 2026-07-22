package com.dylanheartbeat.companion

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class BridgeClientTest {
    private class MemoryDeviceIdStore : DeviceIdStore {
        private var value: String? = null
        override fun save(deviceId: String) { value = deviceId }
        override fun get(): String? = value
    }

    @Test
    fun pairedStatusRequestUsesFakeTransport() {
        val client = ProtocolBridgeClient(FakeDeviceTransport(DeviceAuthorization { true }, batteryLevel = 61))
        val response = client.request(DeviceActions.STATUS_GET)

        assertTrue(response.success)
        assertEquals(61, response.result["batteryLevel"])
        assertEquals(true, response.result["online"])
    }

    @Test
    fun reminderDraftUsesOnlyFakeCompanionHandler() {
        val handler = InMemoryReminderDraftHandler { "draft-1" }
        val client = ProtocolBridgeClient(FakeDeviceTransport(
            authorization = DeviceAuthorization { true },
            reminderDraftHandler = handler,
        ))
        val input = mapOf("title" to "Call Alice", "time" to "2026-07-23T09:30:00.000Z")
        val response = client.request(DeviceActions.REMINDER_DRAFT_CREATE, input)

        assertTrue(response.success)
        assertEquals("draft-1", response.result["draftId"])
        assertEquals("created", response.result["status"])
        assertEquals(mapOf("title" to "Call Alice", "time" to "2026-07-23T09:30:00.000Z"), input)
        assertEquals(ReminderDraft("draft-1", "Call Alice", "2026-07-23T09:30:00.000Z"), handler.get("draft-1"))
    }

    @Test
    fun authorizationCannotBeBypassed() {
        val client = ProtocolBridgeClient(FakeDeviceTransport(DeviceAuthorization { false }))
        val response = client.request(DeviceActions.STATUS_GET)

        assertFalse(response.success)
        assertEquals("DEVICE_NOT_AUTHORIZED", response.errorCode)
    }

    @Test
    fun unknownActionDoesNotReachTransport() {
        var calls = 0
        val transport = DeviceTransport { calls += 1; BridgeResponse(success = true) }
        val response = ProtocolBridgeClient(transport).request("device.control_app")

        assertFalse(response.success)
        assertEquals("DEVICE_ACTION_NOT_ALLOWED", response.errorCode)
        assertEquals(0, calls)
    }

    @Test
    fun pairingTransitionsAndPersistsOnlyDeviceId() {
        val store = MemoryDeviceIdStore()
        val controller = PairingController(FakePairingTransport(), store)

        assertEquals(PairingState.PENDING, controller.createPairingRequest(DeviceIdentity("Pixel")))
        assertEquals(null, store.get())
        val pendingField = controller.javaClass.getDeclaredField("pendingChallenge").apply { isAccessible = true }
        assertTrue(pendingField.get(controller) is PairingChallenge)
        assertEquals(PairingState.PAIRED, controller.confirmPairing())
        assertEquals("fake-device-id", store.get())
        assertEquals(null, pendingField.get(controller))
        assertFalse(controller.javaClass.declaredFields.any { it.name.contains("token", ignoreCase = true) })
    }
}
