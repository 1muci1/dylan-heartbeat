package com.dylanheartbeat.companion

import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URI
import java.net.URLEncoder
import java.nio.charset.StandardCharsets

class PairingTransportException(val errorCode: String) : RuntimeException("Pairing transport failed")

class GatewayPairingTransport(baseUrl: String) : PairingTransport {
    private val endpoint = URI(baseUrl.trimEnd('/')).also {
        require(it.scheme == "http" || it.scheme == "https")
        require(it.host != null)
    }

    override fun create(identity: DeviceIdentity): PairingChallenge {
        val response = post(
            "/api/v1/devices/pairing",
            JSONObject().put("deviceName", identity.deviceName).put("platform", identity.platform),
        )
        return PairingChallenge(
            pairingId = response.getString("pairingId"),
            pairingToken = response.getString("pairingToken"),
        )
    }

    override fun confirm(pairingId: String, pairingToken: String): PairedDevice {
        val encodedId = URLEncoder.encode(pairingId, StandardCharsets.UTF_8.toString())
        val response = post(
            "/api/v1/devices/pairing/$encodedId/confirm",
            JSONObject().put("pairingToken", pairingToken),
        )
        return PairedDevice(deviceId = response.getString("deviceId"), status = response.getString("status"))
    }

    private fun post(path: String, body: JSONObject): JSONObject {
        val connection = endpoint.resolve(path).toURL().openConnection() as HttpURLConnection
        return try {
            connection.requestMethod = "POST"
            connection.connectTimeout = 5_000
            connection.readTimeout = 5_000
            connection.doOutput = true
            connection.setRequestProperty("Content-Type", "application/json")
            connection.outputStream.use { it.write(body.toString().toByteArray(StandardCharsets.UTF_8)) }
            val status = connection.responseCode
            val stream = if (status in 200..299) connection.inputStream else connection.errorStream
            val response = stream?.bufferedReader(StandardCharsets.UTF_8)?.use { it.readText() }.orEmpty()
            if (status !in 200..299) {
                val code = runCatching { JSONObject(response).getJSONObject("error").getString("code") }
                    .getOrDefault("DEVICE_PAIRING_FAILED")
                throw PairingTransportException(code)
            }
            JSONObject(response)
        } catch (error: PairingTransportException) {
            throw error
        } catch (_: Exception) {
            throw PairingTransportException("DEVICE_PAIRING_UNAVAILABLE")
        } finally {
            connection.disconnect()
        }
    }
}
