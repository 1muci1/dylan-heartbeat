package com.dylanheartbeat.companion

import java.time.Instant

data class DeviceCommandRequest(
    val commandId: String,
    val deviceId: String,
    val action: String,
    val payload: Map<String, Any?> = emptyMap(),
)

data class DeviceCommandResponse(
    val commandId: String,
    val success: Boolean,
    val result: Map<String, Any?> = emptyMap(),
    val errorCode: String? = null,
)

class DeviceCommandClient(
    private val deviceId: String,
    private val bridgeClient: BridgeClient,
) {
    fun handle(request: DeviceCommandRequest): DeviceCommandResponse {
        require(request.commandId.isNotBlank() && request.deviceId == deviceId)
        val validPayload = when (request.action) {
            DeviceActions.STATUS_GET -> request.payload.isEmpty()
            DeviceActions.REMINDER_DRAFT_CREATE ->
                request.payload.keys == setOf("title", "time") &&
                    validReminderTitle(request.payload["title"]) &&
                    validReminderTime(request.payload["time"])
            else -> false
        }
        if (!validPayload) {
            return DeviceCommandResponse(
                commandId = request.commandId,
                success = false,
                errorCode = "DEVICE_ACTION_NOT_ALLOWED",
            )
        }
        val response = bridgeClient.request(request.action, request.payload.toMap())
        return DeviceCommandResponse(
            commandId = request.commandId,
            success = response.success,
            result = response.result.toMap(),
            errorCode = response.errorCode,
        )
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
