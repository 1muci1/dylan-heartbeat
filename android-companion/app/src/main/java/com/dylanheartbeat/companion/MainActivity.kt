package com.dylanheartbeat.companion

import android.app.Activity
import android.os.Bundle
import android.view.ViewGroup
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView

class MainActivity : Activity() {
    private val identity by lazy { DeviceIdentityFactory.create() }
    private val pairing by lazy {
        PairingController(FakePairingTransport(), SharedPreferencesDeviceIdStore(this))
    }
    private val bridgeClient by lazy {
        ProtocolBridgeClient(
            FakeDeviceTransport(
                authorization = DeviceAuthorization { action ->
                    pairing.state == PairingState.PAIRED && action in DeviceActions.allowed
                },
            ),
        )
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val status = TextView(this)
        val result = TextView(this)
        fun renderState() {
            status.text = "Device: ${identity.deviceName}\nPlatform: ${identity.platform}\nPairing: ${pairing.state}"
        }

        val createPairing = Button(this).apply {
            text = "Create fake pairing request"
            setOnClickListener {
                pairing.createPairingRequest(identity)
                renderState()
                result.text = "Pairing request created locally. No network was used."
            }
        }
        val confirmPairing = Button(this).apply {
            text = "Confirm fake pairing"
            setOnClickListener {
                result.text = runCatching { pairing.confirmPairing() }
                    .fold(
                        onSuccess = { renderState(); "Fake pairing confirmed visibly." },
                        onFailure = { "Create a pairing request first." },
                    )
            }
        }
        val getStatus = Button(this).apply {
            text = "Get fake device status"
            setOnClickListener {
                val response = bridgeClient.request(DeviceActions.STATUS_GET)
                result.text = if (response.success) response.result.toString() else response.errorCode
            }
        }

        setContentView(LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val padding = (24 * resources.displayMetrics.density).toInt()
            setPadding(padding, padding, padding, padding)
            addView(status)
            addView(createPairing, ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
            addView(confirmPairing, ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
            addView(getStatus, ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
            addView(result)
        })
        renderState()
    }
}
