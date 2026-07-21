package com.dylanheartbeat.companion

interface BridgeClient {
    fun request(action: String, payload: Map<String, Any?> = emptyMap()): BridgeResponse
}

fun interface DeviceTransport {
    fun send(request: BridgeRequest): BridgeResponse
}

fun interface DeviceAuthorization {
    fun isAllowed(action: String): Boolean
}

class ProtocolBridgeClient(
    private val transport: DeviceTransport,
) : BridgeClient {
    override fun request(action: String, payload: Map<String, Any?>): BridgeResponse {
        if (action !in DeviceActions.allowed) {
            return BridgeResponse(success = false, errorCode = "DEVICE_ACTION_NOT_ALLOWED")
        }
        return transport.send(BridgeRequest(action = action, payload = payload.toMap()))
    }
}
