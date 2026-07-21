package com.dylanheartbeat.companion

import android.content.Context

interface DeviceIdStore {
    fun save(deviceId: String)
    fun get(): String?
}

class SharedPreferencesDeviceIdStore(context: Context) : DeviceIdStore {
    private val preferences = context.getSharedPreferences("companion_device", Context.MODE_PRIVATE)

    override fun save(deviceId: String) {
        require(deviceId.isNotBlank())
        preferences.edit().putString("device_id", deviceId).apply()
    }

    override fun get(): String? = preferences.getString("device_id", null)
}
