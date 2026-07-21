# Android Companion Minimal Prototype

This isolated Android Studio project demonstrates the future Android Companion boundary without connecting to a device or production Gateway.

## Structure

```text
app/src/main/java/com/dylanheartbeat/companion/
├── DeviceIdentity.kt       # local device name and fixed android platform
├── PairingController.kt    # pairing lifecycle; clears the transient challenge after confirm
├── PairingTransport.kt     # create/confirm interface and offline fake
├── GatewayPairingTransport.kt # injectable non-production HTTP pairing transport
├── DeviceIdStore.kt        # persists only the paired device ID
├── DeviceProtocol.kt       # status action and bounded request/response models
├── BridgeClient.kt         # Bridge Client, transport, and authorization interfaces
├── FakeDeviceTransport.kt  # offline status response after authorization
└── MainActivity.kt         # minimal pairing and status UI
```

The only supported action is `device.status_get`, returning fake `batteryLevel` and `online` values. `FakeDeviceTransport` requires an injected authorization decision and cannot run an action for an unpaired device.

The manifest declares only `INTERNET`, required for the opt-in Gateway pairing transport. It declares no notification, accessibility, background, package-control, or device-control permission. The Gateway base URL must be injected by the caller; no production address or `GATEWAY_API_KEY` is included. Pairing tokens are kept only in the pending in-memory challenge, cleared immediately after confirm, and never passed to `DeviceIdStore`.

## Tests

Open `android-companion` in Android Studio and run the local unit tests under `app/src/test`. They verify the fake status response, authorization rejection, unknown-action rejection, pairing state transition, transient token cleanup, and device ID persistence. No emulator, physical phone, network service, adb operation, or Node backend is required by these tests.
