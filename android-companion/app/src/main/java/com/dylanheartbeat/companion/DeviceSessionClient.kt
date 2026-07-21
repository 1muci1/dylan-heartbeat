package com.dylanheartbeat.companion

enum class DeviceSessionState {
    OFFLINE,
    ONLINE,
}

data class DeviceSession(
    val sessionId: String,
    val deviceId: String,
    val connectedAt: String,
    val lastHeartbeatAt: String,
)

interface DeviceSessionTransport {
    fun registerSession(deviceId: String): DeviceSession
    fun heartbeat(sessionId: String): DeviceSession
    fun disconnect(sessionId: String)
}

class DeviceSessionClient(
    private val transport: DeviceSessionTransport,
) {
    var state: DeviceSessionState = DeviceSessionState.OFFLINE
        private set

    var session: DeviceSession? = null
        private set

    fun connect(deviceId: String): DeviceSession {
        require(deviceId.isNotBlank())
        check(state == DeviceSessionState.OFFLINE)
        val connected = transport.registerSession(deviceId)
        check(connected.deviceId == deviceId && connected.sessionId.isNotBlank())
        session = connected.copy()
        state = DeviceSessionState.ONLINE
        return connected.copy()
    }

    fun heartbeat(): DeviceSession {
        check(state == DeviceSessionState.ONLINE)
        val current = checkNotNull(session)
        val updated = transport.heartbeat(current.sessionId)
        check(updated.sessionId == current.sessionId && updated.deviceId == current.deviceId)
        session = updated.copy()
        return updated.copy()
    }

    fun disconnect() {
        val current = session
        if (current != null) transport.disconnect(current.sessionId)
        session = null
        state = DeviceSessionState.OFFLINE
    }
}
