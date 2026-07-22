package com.dylanheartbeat.companion

object DeviceActions {
    const val STATUS_GET = "device.status_get"
    const val REMINDER_DRAFT_CREATE = "reminder.draft_create"
    val allowed: Set<String> = setOf(STATUS_GET, REMINDER_DRAFT_CREATE)
}

data class BridgeRequest(
    val action: String,
    val payload: Map<String, Any?>,
)

data class BridgeResponse(
    val success: Boolean,
    val result: Map<String, Any?> = emptyMap(),
    val errorCode: String? = null,
)
