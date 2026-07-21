package com.dylanheartbeat.companion

data class PairingChallenge(
    val pairingId: String,
    val pairingToken: String,
)

data class PairedDevice(
    val deviceId: String,
    val status: String,
)

interface PairingTransport {
    fun create(identity: DeviceIdentity): PairingChallenge
    fun confirm(pairingId: String, pairingToken: String): PairedDevice
}

class FakePairingTransport : PairingTransport {
    override fun create(identity: DeviceIdentity): PairingChallenge {
        require(identity.platform == "android")
        return PairingChallenge(pairingId = "fake-pairing-id", pairingToken = "transient-fake-token")
    }

    override fun confirm(pairingId: String, pairingToken: String): PairedDevice {
        check(pairingId == "fake-pairing-id" && pairingToken == "transient-fake-token")
        return PairedDevice(deviceId = "fake-device-id", status = "paired")
    }
}
