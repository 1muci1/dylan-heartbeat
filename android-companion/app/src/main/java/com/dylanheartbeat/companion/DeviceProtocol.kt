package com.dylanheartbeat.companion

object DeviceActions {
    const val STATUS_GET = "device.status_get"
    val allowed: Set<String> = setOf(STATUS_GET)
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
