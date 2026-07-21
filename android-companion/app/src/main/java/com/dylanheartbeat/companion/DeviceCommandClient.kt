package com.dylanheartbeat.companion

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
        if (request.action != DeviceActions.STATUS_GET || request.payload.isNotEmpty()) {
            return DeviceCommandResponse(
                commandId = request.commandId,
                success = false,
                errorCode = "DEVICE_ACTION_NOT_ALLOWED",
            )
        }
        val response = bridgeClient.request(DeviceActions.STATUS_GET)
        return DeviceCommandResponse(
            commandId = request.commandId,
            success = response.success,
            result = response.result.toMap(),
            errorCode = response.errorCode,
        )
    }
}
