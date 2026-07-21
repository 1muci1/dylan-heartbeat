package com.dylanheartbeat.companion

class FakeDeviceTransport(
    private val authorization: DeviceAuthorization,
    private val batteryLevel: Int = 75,
) : DeviceTransport {
    override fun send(request: BridgeRequest): BridgeResponse {
        if (!authorization.isAllowed(request.action)) {
            return BridgeResponse(success = false, errorCode = "DEVICE_NOT_AUTHORIZED")
        }
        if (request.action != DeviceActions.STATUS_GET || request.payload.isNotEmpty()) {
            return BridgeResponse(success = false, errorCode = "DEVICE_PROTOCOL_INVALID")
        }
        return BridgeResponse(
            success = true,
            result = mapOf(
                "batteryLevel" to batteryLevel.coerceIn(0, 100),
                "online" to true,
            ),
        )
    }
}
