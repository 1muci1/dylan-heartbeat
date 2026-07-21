package com.dylanheartbeat.companion

import android.os.Build

data class DeviceIdentity(
    val deviceName: String,
    val platform: String = "android",
)

object DeviceIdentityFactory {
    fun create(): DeviceIdentity {
        val model = Build.MODEL?.trim().orEmpty()
        return DeviceIdentity(deviceName = model.ifEmpty { "Android Companion" })
    }
}
