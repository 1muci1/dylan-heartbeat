package com.dylanheartbeat.companion

enum class PairingState {
    NOT_PAIRED,
    PENDING,
    PAIRED,
}

class PairingController(
    private val transport: PairingTransport,
    private val deviceIdStore: DeviceIdStore,
) {
    private var pendingChallenge: PairingChallenge? = null

    var state: PairingState = PairingState.NOT_PAIRED
        private set

    fun createPairingRequest(identity: DeviceIdentity): PairingState {
        require(identity.platform == "android" && identity.deviceName.isNotBlank())
        pendingChallenge = transport.create(identity)
        state = PairingState.PENDING
        return state
    }

    fun confirmPairing(): PairingState {
        check(state == PairingState.PENDING)
        val challenge = checkNotNull(pendingChallenge)
        return try {
            val paired = transport.confirm(challenge.pairingId, challenge.pairingToken)
            check(paired.status == "paired")
            deviceIdStore.save(paired.deviceId)
            state = PairingState.PAIRED
            state
        } finally {
            pendingChallenge = null
        }
    }
}
