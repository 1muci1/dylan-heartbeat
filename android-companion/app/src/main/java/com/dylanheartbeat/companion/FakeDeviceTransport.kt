package com.dylanheartbeat.companion

import java.time.Instant

class FakeDeviceTransport(
    private val authorization: DeviceAuthorization,
    private val batteryLevel: Int = 75,
    private val reminderDraftHandler: ReminderDraftHandler = InMemoryReminderDraftHandler(),
) : DeviceTransport {
    override fun send(request: BridgeRequest): BridgeResponse {
        if (!authorization.isAllowed(request.action)) {
            return BridgeResponse(success = false, errorCode = "DEVICE_NOT_AUTHORIZED")
        }
        if (request.action == DeviceActions.STATUS_GET && request.payload.isEmpty()) {
            return BridgeResponse(
                success = true,
                result = mapOf(
                    "batteryLevel" to batteryLevel.coerceIn(0, 100),
                    "online" to true,
                ),
            )
        }
        if (request.action == DeviceActions.REMINDER_DRAFT_CREATE &&
            request.payload.keys == setOf("title", "time") &&
            validReminderTitle(request.payload["title"]) &&
            validReminderTime(request.payload["time"])
        ) {
            val draft = reminderDraftHandler.create(
                title = request.payload.getValue("title") as String,
                time = request.payload.getValue("time") as String,
            )
            return BridgeResponse(
                success = true,
                result = mapOf("draftId" to draft.draftId, "status" to "created"),
            )
        }
        return BridgeResponse(success = false, errorCode = "DEVICE_PROTOCOL_INVALID")
    }

    private fun validReminderTitle(value: Any?): Boolean {
        val title = value as? String ?: return false
        return title.isNotEmpty() && title.length <= 120 && title == title.trim()
    }

    private fun validReminderTime(value: Any?): Boolean {
        val time = value as? String ?: return false
        return time.length <= 40 && runCatching { Instant.parse(time) }.isSuccess
    }
}
