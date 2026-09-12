# v79 Cross-device Personalization Sync

Baseline: `6fccd245b96bcefd023e78606c7534ddf67c94f0` (Home Hotfix), following v78 `ac0ea3fdbbb0ad31578bdce5b29d65f537fb0b12`.

## Personalization Storage Audit

| Field | Existing source and storage | Cross-device before v79 | v79 scope / risk |
|---|---|---|---|
| User / Chen avatar, crop, scale, border | `ai-companion-frontend/storage/user-preference-store.js`, `xinban-user-preferences-v1` localStorage | No | identity; legacy data images require existing asset upload; shared Home/Chat/Voice resolver retained |
| Chat background, position, size, overlay, blur, opacity | Same preference key; `chatBackground`, legacy `background` / `space.profile.background` fallbacks | No | appearance; canonical reference plus bounded display fields |
| Active theme, tokens, visualSlots, customDesign, layout | `ThemeStore`, `xinban-theme-active-v1` | No | appearance.activeTheme; allowed active state only |
| Theme mode / style / font | `appearance.js`, `xinban-appearance` | No | appearance.ui enumerations |
| Local theme library and Studio draft | `xinban-theme-library-v1`, Workshop local design draft | No | Remain local; not active state |
| Theme preset library / versions / share | `theme-preset-service.js`, `runtime-data/theme-presets/presets.json` | Yes | Existing system unchanged; selected ID travels with active theme, no duplicate preset |
| Theme assets | `theme-asset-service.js`, `runtime-data/theme-assets/` | Yes | Existing references only; legacy browser images upload through existing validated multipart route |
| rate / pitch / volume / autoRead / recognitionLanguage / showInterimTranscript | `VoiceSettingsStore`, `xinban-voice-settings-v1` | No | voicePortable |
| voiceSession.continuousConversation / autoSpeak / backgroundMode / backgroundAssetId | Same voice key | No | voicePortable.voiceSession; these are preferences, not live session state |
| voiceURI / voiceName / voiceLang | Same voice key | No | Device-local, never sent; target browser retains its own default voice fallback |
| Provider credentials / selected model / draft / session selection | Separate localStorage / sessionStorage keys | Excluded | No credentials, input drafts, memory, messages, permissions, SW caches or controller state enter sync |

There was no server-side user preference store to extend. The new server persistence supplies the existing browser stores; it is not an alternate avatar store. Runtime data directory names were inspected without reading preference or asset contents.

## API and persistence

New write interfaces: `POST /api/personalization/bootstrap` and `PATCH /api/personalization`. Read interface: `GET /api/personalization`. All require the existing Bearer GATEWAY_API_KEY, including local requests. Responses use no-store. No query token or second secret.

JSON: `{version:1, revision, updatedAt, sections:{identity, appearance, voicePortable}}`. Each section is `{revision, updatedAt, data}`. Data fields follow the audit table. A PATCH supplies `{section, baseRevision, patch}`. Only its section revision advances; stale revisions return HTTP 409. Top-level section fields replace atomically; the flat ui and voiceSession preference maps preserve unspecified siblings. customDesign is never automatically deep-merged across conflicting devices.

`runtime-data/personalization/state.json`: 0700 directory, 0600 file. Synchronous serialized writes use an exclusive lock directory, unique temporary file, file fsync, rename and directory fsync. Corrupt data fails closed; it never silently becomes an empty store. GET empty does not create directories. No database schema migration is required.

The existing EventStore records initialization/update facts containing only section and revisions. No personalization body, credentials, chat or memory is recorded. Theme asset deletion also checks current personalization references.

## Browser lifecycle

- Local UI first, then a read of cloud state. Startup does not upload old browser settings.
- Empty server displays explicit “使用此设备作为初始配置”. The selected device converts legacy PNG/JPEG/WebP data images using the existing Theme Asset upload API, then bootstraps. Already-existing canonical assets are not uploaded again.
- A second bootstrap is rejected. Existing cloud state is applied through UserPreferenceStore, ThemeStore and VoiceSettingsStore.
- User changes apply locally and queue per section. Changes debounce for 500 ms; manual sync / browser online events can retry. There is no periodic retry loop.
- `personalization-sync-v1` stores initialized, lastServerRevision, lastSyncedAt, cloud cache and pending sections with their original base revisions. Old storage keys remain.
- A conflict preserves local pending state and displays cloud/local choices. Choosing local explicitly retries against the displayed cloud revision; a newer concurrent write still conflicts.
- Offline GET preserves local UI; failed PATCH preserves pending visual changes. Device voice identifiers remain local when cloud settings are applied.
- No permissions, microphone activation, voice session state or Wake Lock is applied by sync.

## Validation and migration boundaries

Server section and nested fields are whitelisted. Assets accept canonical `/api/theme/assets/:uuid` references only; no data/blob/file URLs, external URLs, arbitrary CSS, selectors or credential fields. Theme validation reuses the existing preset sanitizer and theme normalizers. Local legacy data images are uploaded through the existing binary image validator, never accepted as personalization payload strings.

Unknown legacy image references are reported instead of fetched or silently discarded. Existing theme resources, presets, drafts, shares and versions are not copied. Browser-dependent voice identifiers are not migrated.

## Acceptance

`test/personalization-sync-v79.test.js` covers server/auth/schema, explicit migration, avatars/background/themes/voice, conflicts, offline retry, private persistence, EventStore failure, corrupt state, cross-origin resolution and missing-image fallback. Full regression includes v78 Voice, Home Hotfix, v76 Theme, v49 Game, uploads and memory.

`MULTIMODAL_MODE=text node scripts/personalization-browser-v79.js` runs a local fake server with two fresh Chromium user-data directories. Only fake authentication is seeded; no personalization localStorage is copied. It validates explicit bootstrap, new-mobile pull, mobile background update, unchanged avatar revision, Home/Chat/Voice rendering and mobile overflow. Artifacts default to `/tmp/v79-browser/`. Production personalization is never initialized by this test.

Build: frontend v79-p4b; SW xinban-shell-v79-p4b / revision v79; Game game-v49-p4b unchanged. Historical cache-marker tests are updated to the current shell version; legacy redirect pages stay unchanged.

## Real-device release gate

After automated checks and deployment, the user must initialize from the configured desktop, then verify Windows Edge and a real phone: both avatars, crop, Home, Chat background/theme, Voice avatar/background; change phone background and sync desktop without losing avatars. No push until the user accepts this real-device check. Gateway may restart for backend changes; wake-up must not restart. imports/ stays untouched.

## Automated release result

- New sync coverage: 56 tests, 56 pass, 0 fail.
- Full `MULTIMODAL_MODE=text npm test`: 1258 tests, 1258 pass, 0 fail (outside the sandbox that blocks Node child processes).
- All 38 changed/new JavaScript files passed `node --check`; `git diff --check` passed.
- Two independent Chromium profiles passed; three legacy test images uploaded, no existing asset copied; identity revision remained 1 while appearance revision became 2.
- Deployed static files: 27/27 local, deployed and HTTP SHA-256 matches.
- Authenticated local/public GET: HTTP 200, initialized=false; unauthenticated public GET: HTTP 401. All returned no-store. Production bootstrap remains reserved for the user's configured desktop.
- Gateway PID 939 → 73846, restart count 0 → 1, online. wake-up PID 938, restart count 0, online, unchanged.
- Real Windows Edge + phone verification remains pending. No push.

## Gateway connection separation hotfix

First-party personalization and theme requests use `XinbanThemeGateway.resolveGatewayUrl` with its deployment fallback, without an AI Provider base URL. Production resolves to `https://api.xiaowo.homes`; the deterministic test deployment resolves to its own local origin.

The existing `xinban-provider-config-v1` localStorage record now has a `gatewayConnection` slot containing the canonical baseUrl and the user's existing Bearer credential. `getProviderConfig()` exposes only AI Provider fields. Provider saves preserve the Gateway slot. No new secret or localStorage credential key is generated. A legacy canonical Gateway configuration is retained only after a successful read-only authenticated GET. Explicit Gateway configuration uses the existing settings dialog, validates with GET, then saves the connection without replacing the AI Provider. Failed validation preserves the previous slot. Explicit disconnect clears the slot and sets a device-local marker preventing automatic legacy reconnection.

Missing Gateway connection makes no personalization request and displays “尚未连接映我同步服务。” with a link to the existing configuration dialog. 401, 403, 404, 409, 5xx, fetch network failures, malformed responses, and other exceptions have separate safe UI states. Sync copies recursively remove credential/token/password/secret/Authorization/API-key and device voice fields; Gateway configuration is never included in captured sections, pending snapshots, bootstrap/PATCH bodies, cloud state, or EventStore payloads.

Validation: 1286 tests passed, 0 failed. `MULTIMODAL_MODE=text V79_CONNECTIONS_ONLY=1 node scripts/personalization-browser-v79.js` passes three independent Chromium profiles: Gateway Provider; third-party Provider with saved Gateway connection; third-party Provider without Gateway connection. The first two show uninitialized and send only the Gateway credential; the third sends no sync request and shows the connection entry. Provider switching/reload and explicit connect/disconnect via the reused settings dialog pass. This acceptance mode performs zero bootstrap/PATCH requests, even against the fake server. Unit tests exercise write payload boundaries only against fake adapters.

Changed JS assets use the independent `v79-p4b-sync3` cache suffix. Frontend v79-p4b, SW xinban-shell-v79-p4b, revision v79, and game-v49-p4b are unchanged. Production initialization remains reserved for the user's Windows Edge acceptance. No backend changes or process restart are needed.

## Real-device upload 415 follow-up

The production read-only GET remained HTTP 200 / initialized=false / state=null. Available Gateway request records show three image upload attempts returning HTTP 415 on 2026-09-26 (15:01:14, 15:01:18, 15:04:01 UTC), each after a successful personalization GET; no personalization bootstrap POST was received. Those responses' business error codes were not retained in the available request logs. The exact image validation subreason remains unconfirmed.

Contract audit: Workshop previously sent the selected File; personalization decoded a data URL into a Blob with a generated filename. Both used the `file` multipart field, browser-generated Content-Type boundary, canonical Gateway URL and saved Gateway credential. The old inline uploader also passes the new PNG/JPEG/WebP fixture contract tests. There is no evidence of a field/boundary/raw-body defect, and replacing it is not proof that the original production 415 is resolved.

Workshop's multipart upload now lives in `XinbanThemeGateway.uploadThemeAsset`, shared by Workshop and personalization. It accepts File/Blob, validated data URLs and readable same-origin object URLs, validates the returned asset ID, and uses the existing authenticated request helper. Canonical asset references are reused; external/old URL references require the existing safe Asset Library import flow, not a direct browser fetch. Unsupported, malformed and unreadable sources fail explicitly. Server MIME, structure, size, SSRF and asset validation rules are unchanged.

Migration errors expose only a fixed slot label (userAvatar, chenAvatar, chatBackground, voiceBackground, themeVisualSlot), HTTP status and allowlisted error code. No image data, source URL, credential or server message is logged. The primary action follows the last authenticated server initialization state: confirmed false retains the initialization button after errors; only confirmed true shows sync-now. An unknown server state does not offer a write action.

All images must migrate before bootstrap. A failed slot stops migration without a personalization write. Already-created assets retain the existing Asset Library lifecycle and are not deleted; successful uploads may be reused on an explicit retry in the same page. Local preference stores are not replaced until bootstrap succeeds.

`V79_MIGRATION_ONLY=1` adds isolated Chromium acceptance with synthetic PNG user avatar, JPEG companion avatar and WebP chat background. An injected 415 on the second upload verifies zero bootstrap calls, a retained initialization button, hidden sync-now and a safe companion-avatar error. Explicit fixture retry then verifies exactly one bootstrap, three assets and the synced UI. This harness blocks production URLs. Test images in `test/fixtures/personalization-images-v79.json` were generated from a 16×16 canvas; they contain no user data.

Changed frontend assets use `v79-p4b-sync4`. Base frontend, SW, revision and game versions are unchanged. No backend edit or PM2 restart is needed. Production writes remain reserved for the user's explicit Edge action; the original 415 subreason must not be described as confirmed without its safe error code.

Follow-up validation: final `MULTIMODAL_MODE=text npm test` passed 1304/1304, zero failures. Changed JavaScript syntax checks and `git diff --check` passed. Final isolated migration acceptance and A/B/C credential-separation acceptance both passed. Read-only production GET still returned 200 / initialized=false / state=null. Gateway PID 73846, restart count 1, online; wake-up PID 938, restart count 0, online. No real bootstrap/PATCH, backend changes or service restart were performed.

### Avatar structure repair (sync5)

The current picker uses FileReader data URLs and returns the original for small files (and on optimization failure); it does not ensure a canonical container. Avatar rendering reads those same fields and applies crop/scale as CSS. The migration's Base64 decoding and multipart round trip preserve bytes. The upload route calls `validateImageStructure` **before** MIME magic validation, so STRUCTURE_INVALID alone does not prove that declared MIME matches bytes. No production avatar was read by this change; the exact Edge file's failing predicate remains unknown until local diagnosis.

A reproducible fixture is a complete JPEG followed by two zero bytes: Chromium decodes it, but the server requires FF D9 at the very end and returns STRUCTURE_INVALID. The new local-only avatar helper verifies whitelist, signature, dimensions, static-image status and browser decoding before any upload. During explicit bootstrap only, avatars with nonstandard structure are re-encoded at their full decoded size to PNG; the re-decoded PNG must match original canvas pixels exactly. Standard valid images retain their exact bytes. Animated images, MIME mismatches, disguised SVG/HTML, failed decoding, unreadable/tainted canvas, changed pixels or excessive PNG size stop initialization and require reselection. Existing canonical assets are reused. No server security checks or backend files change.

Crop/scale remain separate and unchanged. Before bootstrap submission, `personalization-original-avatars-v79` retains a local list of original identity snapshots; cloud application can replace active references without destroying original images. Backup failure blocks bootstrap. Normalization itself never writes storage. No logs contain image data. Failed avatar migration never substitutes a default. Other assets continue through the existing canonical uploader, and bootstrap happens only after all succeed.

Safe diagnosis, manually in the affected Edge browser's console after loading the updated Settings page (no upload, no storage mutation, no remote image fetch):

```js
await CompanionAvatarMigration.diagnose(
  new CompanionUserPreferences.UserPreferenceStore().getUserAvatarImage()
)
```

The result contains only declared MIME, byte length, detected format, dimensions, structure flags and decode success (or a safe error code). `checks.terminalEOI=false` identifies the reproduced JPEG condition; PNG reports minimum length/IHDR/IEND, WebP minimum length/RIFF length/dimension parsing. These local diagnostic checks are descriptive, not a substitute for the unchanged server validator. Do not print the input, preference object or data URL.

`V79_MIGRATION_ONLY=1` now covers an actual structure rejection, PNG/JPEG/WebP uploads, failed user-avatar decoding with zero uploads/bootstrap, MIME mismatch, SVG rejection, canvas errors, original backup, crop preservation, continued migration and exactly one fake bootstrap. Both full decoded pixel arrays and actual cropped CSS avatar screenshots match before/after. Only synthetic fixtures and temporary local stores are used; production URLs are blocked.

Validation for sync5: `node --check` passes for all changed JavaScript; `MULTIMODAL_MODE=text npm test` passes 1312/1312; `git diff --check` passes. Isolated Chromium migration acceptance passes with pixel equality and identical cropped-avatar PNG screenshots. Production read-only GET returned HTTP 200 and `initialized:false`; no real bootstrap/PATCH was sent. Deployment is limited to changed static files and cache references, with no process restart.

### 2026-09-28 real initialization diagnosis (sync6)

Authenticated production GET only: HTTP 200, initialized=false, state=null,
revision absent, no business error. No production bootstrap/PATCH was performed.
Gateway request log (UTC) for the latest attempt:

| Time | Request ID | Request | HTTP |
| --- | --- | --- | --- |
| 04:40:04.365 | req-nwf | GET personalization | 200 |
| 04:40:08.540 | req-nwh | GET personalization | 200 |
| 04:40:09.284 | req-nwj | GET personalization | 200 |
| 04:40:11.694 | req-nwl | GET personalization | 200 |
| 04:40:12.846 | req-nwn | POST theme/assets/upload | 200 |
| 04:40:38.747 | req-nwp | POST theme/assets/upload | 200 |
| 04:40:57.183 | req-nwr | POST theme/assets/upload | 200 |
| 04:41:01.418 | req-nwt | POST personalization/bootstrap | 400 |
| 04:43:30.031 | req-nwv | GET personalization | 200 |

Corresponding OPTIONS returned 204. Latest failure is bootstrap submission,
not the historical upload 415. Request completion proves Gateway received it;
logs do not distinguish parser rejection from handler validation or retain the
400 response code. Do not infer INVALID_PERSONALIZATION or an offending field
from the status alone. The exact rejection remains undetermined.

Before deployment, local HEAD, deployed files, and HTTP bodies matched for
settings, space, boot, sync, avatar migration, shared uploader and sw.js.
The user's Edge runtime/cache is not remotely observable; no matching Nginx
resource records were available. Existing SW uses exact-URL cache-first JS;
old cached resources are possible, not established as this incident's cause.

Confirmed display defect: bootstrap catch mapped the error to requestError,
while only image preparation populated migrationError. sync6 retains safe
stage/slot/status/allowlisted code through normalization, upload and bootstrap,
including failures during preflight, capture and avatar backup. Unknown messages
and response bodies are never displayed. Server validation and migration
algorithms are unchanged. Updated changed-module URLs and shell cache generation
prevent old exact-URL cache entries from serving the new release URLs.

Fresh isolated Chromium acceptance (V79_ERRORS_ONLY=1) submits an invalid
synthetic UI enum to the local fixture, verifies bootstrap HTTP 400 with
INVALID_PERSONALIZATION and no upload, retains initialization button, then
checks sync6 scripts and SW cache after navigation. This fixture code is NOT
asserted to be the historical user's error code. V79_MIGRATION_ONLY=1 also
passes synthetic raster conversion, slot-specific upload rejection and retry.

The user must refresh and explicitly retry initialization; a continuing failure
should now show its safe stage/status/code. Do not clear user storage or claim
that the underlying bootstrap validation failure has been fixed.

Validation: all changed JavaScript passed node --check; MULTIMODAL_MODE=text npm test passed 1314/1314; git diff --check passed.

Deployed only the following 19 static files. Each returned HTTP 200 and matched local and deployed SHA-256:

| Resource | SHA-256 |
| --- | --- |
| collaboration/index.html | `495bd87d970ff0146364a23436dcb97ce86ae1feab3622aa9961fb82cbfd17ae` |
| game/index.html | `124492aebd84504b00310bf5e4fde15047117655a610f5a9fe7b4c13ef1ba4a2` |
| space/index.html | `49809a6859d74d0a0646a80c31c1d890483942d612f492fa175ffb5d9abc4ce5` |
| space/studio/index.html | `1611cd6b3a5e811b60b364655ba639fdd15d78afb2d6224b4886e461abea4d5b` |
| ai-memory-review.html | `bdbb6c1eb2688178600814c213c9c686aac1ebc12104681241de6c50c3b7a57f` |
| assets/js/personalization-boot.js | `19c5d45274c5b523627f1667d629b1256e1e2dfbcb8d1d39855a522b74d96bd5` |
| assets/js/personalization-sync.js | `fd1d5c45c65419a465e151a5ac82c8b85f63e8d150eb6a3c475c136c3ec4bf9a` |
| assets/js/theme-gateway.js | `a9ca9596a005ff8796dad0f46bb3fd02ee15d7c93f96533ccf1f75aaca8f54c4` |
| chat.html | `51c7a99978e408369e99a0e8064ad05468d4ae4ef2c11e50d5840edb9fc2dd9f` |
| dashboard.html | `3067c3a52b866b7bb8dd79b45c19a43f1fafbf9e5a408e4c7f1a18e358e91a9d` |
| index.html | `7b0a0a422352bb7479362a73b2f5706f4d9766783612e70c1b8c99f83119defe` |
| memory.html | `224fe1e08144895fe41b426825bba976c58c1965a538675d899492825e8274d3` |
| proactive-explanation.html | `6130ced2580a8fd5851e18688404fe5b5b1e2c7a4874b635840e785c561eafb9` |
| settings.html | `add70df4f9583e9e4bad3078a18671c6582a7bc0fbc24daf3908d94966bcef6f` |
| stickers.html | `d799bd35048d500307cc2941dc862a91c0502b8a79856402d43365141e811ea0` |
| sw.js | `eb042e3540aae126c4be4da23dc12d55441343ab0b4500ea5b0e05a7f6e5d94a` |
| theme-center.html | `468945fe232883a1001193da8bb52f156552311fc8efd4eeefed1027ca6ce70b` |
| theme-community.html | `f31cb3140e3e10645d14e4644de5c3cbf67d9fbe9dcba25d9af73bb88d2c5677` |
| theme-workshop.html | `e681541fbd5c0994168563b49dc13e1d804864fc577b293113e1ef00d32fe258` |

### 2026-09-28 bootstrap schema correction (sync7)

The user confirmed the latest Edge response: GET 200, three uploads 200,
bootstrap 400 / INVALID_PERSONALIZATION. No production payload or image was read.
Code-path reproduction uses AvatarStudio.save -> UserPreferenceStore ->
SyncClient.capture -> prepare -> actual PersonalizationStore.validateSection.

Confirmed rejecting paths in the isolated reproduction:

| Safe path | Expected type/condition | Actual type | Code |
| --- | --- | --- | --- |
| identity.userAvatar.crop.zoom | absent; crop keys are x/y only | number | INVALID_PERSONALIZATION |
| identity.chenAvatar.crop.zoom | absent; crop keys are x/y only | number | INVALID_PERSONALIZATION |
| identity.chenAvatar.border | string in server enum | string in supported local enum omitted by server | INVALID_PERSONALIZATION |

AvatarStudio.save stores crop={x,y,zoom} and duplicates zoom as scale. The old
capture copied the entire crop. avatar() calls keys(value.crop,["x","y"]),
so the extra zoom fails before coordinate numeric validation. The same exact
crop fails PATCH because both use validateSection. The local supported border
"minimal" was also absent from the server enum; AvatarStudio and Space expose
it and avatar.css renders it. This is an enum mismatch, not a type mismatch.
These are demonstrated source/fixture defects; without the real request body,
we cannot assert which avatar or border was the first rejection on that device.

Minimal correction:
- Capture removes only the redundant local crop.zoom, preserving x/y and the
  existing renderer scale. Legacy zoom-only data maps zoom to cloud scale.
  Other unknown crop fields remain subject to strict server rejection.
- AvatarStudio.defaultChen restores editor zoom from cloud scale, with legacy
  crop.zoom fallback. No image conversion or image security logic changes.
- Personalization avatar border enum adds only the already-supported minimal
  option. Existing compatibility values remain. No generic validator relaxation.
- Changed static module/loader URLs use sync7; unchanged uploader uses sync6
  and avatar image migration uses sync5. Shell cache is sync7.

Schema audit:
- There is no separate buildBootstrapPayload function. bootstrap currently
  serializes exactly {sections}, where each section is plain data from capture
  and prepare, not a complete local preference object.
- version/revision/timestamps belong to cloud state produced by the server.
  GET state has sections[name]={revision,data}; bootstrap must not send wrappers.
- PATCH is {section,baseRevision,patch}; bootstrap and PATCH share validateSection.
- Identity includes only the selected avatar fields. Canonical image references
  are /api/theme/assets/<UUID>; crop x/y are numbers 0..100 and scale is 1..5.
- Appearance includes chatBackground, allowlisted activeTheme fields and ui.
  tokens/assets/layout/visualSlots are checked against DEFAULT_THEME shape;
  customDesign version is 1, regions use DESIGN_REGIONS/REGION_DEFAULT.
  sanitizeTheme continues to reject external/inline asset references.
- Local ThemeStore normalization already restricts visualSlots/customDesign to
  canonical asset URLs. Tests use this supported structure, plus legacy inline
  theme.assets background migrated through prepare, rather than claiming inline
  visualSlots survive ThemeStore normalization.
- Voice includes only portable top-level fields; VoiceSettingsStore normalizes
  voiceSession to its four supported fields. Device voice names, URIs and
  credentials are excluded. Voice background is an asset UUID, not a full URL.
- Unknown fields, null/wrong numeric types, unsafe image references, metadata
  at bootstrap root and revision wrappers remain rejected. No snapshot reset,
  no default replacement of avatars/background/theme/visualSlots/customDesign.

New isolated tests in personalization-schema-v79.test.js exercise real multipart
routes, ThemeAssetStore, Personalization routes, validator, persisted cloud state,
GET and PATCH with synthetic images. They verify three sections, both crops,
canonical theme/background references, portable voice background, secret exclusion,
strict rejection, and initial state preservation after errors. Chromium
V79_SCHEMA_ONLY=1 uses actual AvatarStudio saves, demonstrates rejected legacy
crop then successful corrected bootstrap, retains the failure button and checks
post-sync scale and theme references. No mocked-success bootstrap API is used.

Final validation: node --check passed for every changed JS; MULTIMODAL_MODE=text npm test: 1318 passed, 0 failed; git diff --check passed. Chromium schema acceptance passed against actual fixture routes/validator.

Production GET after Gateway restart: HTTP 200, initialized=false, stateIsNull=true, revision=null. Gateway online, PID 484222, restart count 2 (previously 1). wake-up online, PID 938, restart count 0 unchanged. No production write request or asset deletion. Backend runs directly from this checkout; personalization-store.js SHA-256: `ac051ef4a9cbb760a7ff64fc848d4e74ffe8c3518f02c600596508a101733531`. It is not an HTTP-served resource.

Sync7 deployed static SHA-256 (19/19 local = deployed = HTTP; all HTTP 200):

| Resource | SHA-256 |
| --- | --- |
| avatar/avatar-studio.js | `13afa46adc44bf10a608f1ec5854ef895297145b1f523e185d49cb3fd2cea27c` |
| collaboration/index.html | `34673d81fd04536a5579f93fd12b9d9361b0a7ae1b6ad65ec18922e5844268b7` |
| game/index.html | `0c9784bf3568d796e12da9f5e14d1d289efa219af687a8b3c1364d89e82a2bc4` |
| space/index.html | `5960d84de960dbcf2646dd4f6ac0359225dfdd0592eb6d55a78d13aae0e5a248` |
| space/studio/index.html | `06220e52d0d50734dddd7f6e1295854ad0edcf804c1df82cc0aadeff10d1201d` |
| ai-memory-review.html | `420b302af79e4be5acf1ffebd91fd0f272d5f9a18591e43f3f0f089dbbc9009c` |
| assets/js/personalization-boot.js | `dfcee95cf17d1a5276ea9e33fba62dd45212318fd4d4173f6eb9604fea207bd5` |
| assets/js/personalization-sync.js | `51a821e6d66b631843bbbef96fe68ba280ce77b8c0d1c392b65b1917a258d846` |
| chat.html | `5c4faad44f59feb30ab1835dc0fb1f307b52639755219e2b812b4ce51f8a9c28` |
| dashboard.html | `30ab794a369b124ff0b00094778273b61aab405301b38b46bdf0fe4e73981bda` |
| index.html | `fce2162dd89443d77f7d54a75e09f866b080c02447576c5620289eec5c5a68e5` |
| memory.html | `857e3a1e9bac958de5dbbaebb9295bf8db7f5a1a287d8a0751ed36498405faba` |
| proactive-explanation.html | `508cbfee2f3e6b49ebe2c85bdc5335aa1ea058296828823316f645d18a06e0e2` |
| settings.html | `5f3d673a26faa673ddfe0f26d93cbd9aca97a641d0657c71e40a3024e78dffe0` |
| stickers.html | `ac376eb500dbafa600adb0c2fb2d0a1a8de5adbfa5f98d0d1145c240f8503c33` |
| sw.js | `6bb590aa8793a9d364066efd345649d2a2f4612a303ab7f4718f7370afa89947` |
| theme-center.html | `dc71987c1804e7e169c13aa7d8e27a565c995e3d3f56c73e2de980ffbda4a955` |
| theme-community.html | `3278f5e08afb55a0370b8b59ddf280fa159b2e778227f532f834e5b084860a79` |
| theme-workshop.html | `3602d7302ddbb8758dd02d85d7c881f59ea061ff38fd3a1b6b122f3fb128550a` |

### 2026-09-28 avatar backup quota correction (sync8)

The latest user-visible error is `avatar-backup / LOCAL_STORAGE_QUOTA_EXCEEDED`,
following successful GET and three successful image uploads. The exact throwing
operation in sync7 was `storage.setItem("personalization-original-avatars-v79",
JSON.stringify(saved))`. `saved` was an array of captured identity snapshots:
userAvatar and chenAvatar, each containing the entire imageData data URL, crop
x/y, scale and optional border. This duplicated both original images already in
`xinban-user-preferences-v1`; identical snapshots were skipped, but changing crop,
scale, border or either image appended another complete pair. No retention bound
or image-level deduplication existed. The exception occurs before bootstrap and
before cloud application, so this failed attempt leaves original preferences in
place. This source-path diagnosis does not require reading the user's images.

The backup cannot simply be removed: successful cloud application normally
replaces active avatar data URLs with canonical asset references. A reference to
the old preference key alone would therefore cease to be a recoverable original.
AvatarMigration only inspects/re-encodes images in memory; CompanionChatAvatars
only reads preferences for rendering. UserPreferenceStore has its own historical
duplicate-root normalization, but no independent image archive. Existing
IndexedDB is the chat history store, whose schema is not a reusable binary asset
store; it and all chat/memory data remain unchanged.

`avatar-backup.js` adds an independent version-1 IndexedDB database,
`personalization-avatar-backup-v79`, with `images` and `snapshots` stores. Standard
data URLs become original binary Blobs without pixel conversion, while snapshots
retain image references and crop/scale/border recovery metadata, including legacy
crop.zoom. Noncanonical original data URLs use a lossless text Blob fallback.
SHA-256 content keys deduplicate images across both avatars and across changed
snapshots. Identical retries reuse the same snapshot; changed recovery metadata
can create a small new snapshot without duplicating unchanged image bytes.
Temporary blob URLs are never treated as durable backup references.

Backups wait for the transaction to commit, then reopen/read and reconstruct both
originals, checking their hashes and the snapshot hash before permitting uploads
or bootstrap. A matching old localStorage backup can be reused read-only; old
backup arrays are neither overwritten nor deleted. New backups write no
localStorage entry. There is no quota-cleanup fallback and no storage reset.
Malformed existing backup data, unavailable IndexedDB, failed transaction,
failed readback, or quota failure stops initialization. Original settings are
untouched on these failure paths; no image/theme/chat/memory deletion is added.
No backend or database schema change is involved.

Backup now precedes image uploads, preventing quota failures from creating more
unreferenced assets. The existing in-memory upload map continues to reuse a
canonical asset reference for the same source during this controlled page flow;
responses are validated before entering that map. Failed/temporary references
are not cached. Reloading loses that map: historical uploads cannot safely be
matched to originals without a verified source mapping, so they are not guessed
or deleted. Server asset validation and avatar image normalization are unchanged.

For avatar-backup quota failures the UI says:
“本机头像备份空间不足，云端尚未初始化。原有头像和设置已保留。”
It retains the explicit initialization button and offers “导出本机头像备份”.
Export creates a local JSON download with both original images and recovery
metadata; it never writes cloud state or bypasses the backup gate. Exported
identity entries contain imageData and crop/scale/border, allowing extraction of
both original image files and restoration of their crop/scale. The restore API
reconstructs the same identity from IndexedDB without automatically applying it.
No automatic import or overwrite of existing preferences is introduced.

The isolated `V79_BACKUP_ONLY=1` scenario uses synthetic rasters and fresh
Chromium profiles. It waits for the initial Service Worker activation refresh
before storage tests. It covers small originals, exact reconstruction after
reload, legacy localStorage backup compatibility, a large synthetic image used
by both avatars, actual localStorage quota exhaustion reproducing the old write,
image/snapshot deduplication, original preference preservation, a fake IndexedDB
QuotaExceededError at the real object-store write boundary, transaction rollback,
zero uploads/bootstrap on backup failure, manual export, and upload retry reuse.
IndexedDB quota is injected because this Chromium lacks Storage.overrideQuota;
it is not claimed as physical disk exhaustion. Standard two-profile acceptance
separately checks Home/Chat/Voice rendering and cross-device crop/scale behavior.

Final sync8 validation: all 15 changed/new JavaScript files passed node --check;
MULTIMODAL_MODE=text npm test: **1331 tests, 1331 pass, 0 fail**, no skips.
`git diff --check` passed. Isolated Chromium backup, two-profile rendering,
migration, schema and error-display modes all passed. The backup fixture used a
1,203,746-character synthetic data URL; identical images in both avatars occupied
one binary object, while two distinct originals occupied two. Repeated identical
backups retained one snapshot. Both quota failure paths retained originals and
had bootstrap=0; the IndexedDB failure also had uploads=0. After a successful
backup, an injected second-upload rejection followed by retry made four upload
attempts total, creating three assets (the successful first asset was reused).

Deployment changed only the 19 static resources below. All returned HTTP 200,
with local = deployed = HTTP SHA-256. No backend change or process restart.
Read-only production GET after deployment: HTTP 200, initialized=false,
stateIsNull=true, revision=null. Gateway PID 484222 / restart 2 / online;
wake-up PID 938 / restart 0 / online, both unchanged. No production bootstrap,
PATCH, asset deletion, push, or imports/ changes. Real initialization remains
reserved for the user.

| Resource | SHA-256 |
| --- | --- |
| collaboration/index.html | `ef31fa099639791c4b6879383b05cdb122f8bf6818afd4b2f1b022c1b56a7229` |
| game/index.html | `224b28d20f0f55232f1268a25dd5d54ed687ef6d74f8529240950de3e53987e9` |
| space/index.html | `6e7ec38cfdd024626143a4bb03c23ba2977e7a2ac3916144abcf5e14010e87ca` |
| space/studio/index.html | `70cbd01cedf47281c90f30cd1d2c8c491dd590bbc503c24cb55f928630dbb30a` |
| ai-memory-review.html | `b9fcc23874a34f7234b7d006e0196f740847b89acd6fb2220397d54022d111b3` |
| assets/js/personalization-boot.js | `e6f51ba17acc3c01b683e1a38fbdbb95ed12aa8e8bf4c2bbe0a4120fdd396bf3` |
| assets/js/personalization-sync.js | `54dd069eb568e5c228822ecf6bb9d4c5426e86ab7b93b46f5b6d00da3c48e085` |
| chat.html | `30e0dfda149154533c6cede5aaa95fa9bf9378a3dd25ca881b591e2f9bd949b1` |
| dashboard.html | `5448287945c54b9fab295dec2ae3b0a1053b83d4f0e2c6b48aca7017377ab526` |
| index.html | `80141e1e4f6c4c56615453ade3cdf10706476f8cb6b7ffb7da854e23cc9b0892` |
| memory.html | `0d267189bf0ab4de86f3a0341ee56aa8c2aacf9eecaad3f0b49d8cefc506f9c2` |
| proactive-explanation.html | `9b8d0dff95309c3ff7cecc6c8dc7152e34f94a537f0875e9cf7a0f2a36158039` |
| settings.html | `3920782a638fce9014bd48e807df4eaa5f6d437747c44c882236f41b4e72f2e9` |
| stickers.html | `839027f99d3a2f1b6dd93a13b6bb41bda34e4c598a96f137c1b8f617ee56b472` |
| sw.js | `c93cf01a8f8e4f9da91fda6ecfc1101fb60040243894cf507f98342b46c88b49` |
| theme-center.html | `49a26a420c93f9a695efc878c4ffab19b85070c8b1929cd60cd0b5738e90ec45` |
| theme-community.html | `6466b02f24a1fab5424d89b8384d60506ca20241aef78553e541e818c4f0e4cb` |
| theme-workshop.html | `466a50de0cc5294c7b2324b66d990d54edaadd0e84a2ce2f300f7cbcbf235aa2` |
| assets/js/avatar-backup.js | `1a465c1379cfff1e55384d0d6d5e188d02d3a91d1cfd21cba51998b951fddcf7` |

## v79 sync9: independent mobile Gateway connection

Read-only source analysis of 191b570: the sync link opens settings with
`connection=gateway`, which used the Global Provider dialog and its submit
handler. Gateway-only mode set label.hidden, but the shared stylesheet's explicit
`display:grid` and `display:flex!important` override native hidden rendering.
The Global Provider heading and model defaults remained, the credential lived
farther down the long scroll form, and failure feedback was a generic message in
that scroll area. There was no pending state or timeout. The handler exists and
uses GET /api/personalization before saving. No native required-field validation
blocks submission (the form has novalidate). These are verified code defects;
without Safari instrumentation the exact error from the user's tap is unknown.
It is not evidence that the user clicked incorrectly or lacked a credential.

Gateway Connection retains the existing device-local gatewayConnection slot in
the Provider storage record. It is logically independent from the chat Provider;
connect validates before replacing it, Provider saves preserve it, and portable
Personalization excludes it. Existing canonical-origin legacy migration remains;
third-party Provider credentials are never substituted by the new form.

Settings now has a separate Gateway dialog and submit handler, reusing
XinbanThemeGateway.connect and AppConfig.saveGatewayConnection. It reads only
Gateway Connection, not Provider auth. Blank input gives GATEWAY_NOT_CONNECTED;
401/403 give fixed safe errors; network/storage failure stays visible. Pending
state prevents duplicate saves, and a 15-second abort bounds network waiting.
Success clears the input, closes the dialog and uses the existing connection
change event to refresh sync. Device-connected status no longer depends on cloud
initialization. The full Global Provider form and its save path remain intact.

The dialog keeps feedback/actions outside the scrollable fields, uses 44px
buttons, 16px inputs, safe-area bottom padding and visualViewport resize/scroll
tracking. Cache sync9 refreshes changed assets without changing the v79 build.
Five existing cache-version assertions were updated accordingly.

Acceptance: V79_GATEWAY_MOBILE_ONLY=1 uses a new Chromium profile, touch events,
a localhost fake credential service and blocked external HTTPS. It covers blank,
valid and invalid credentials; rejected rotation retaining the old connection;
Provider save and reload retaining Gateway Connection; updated sync card for both
uninitialized and initialized fake cloud; no third-party credential sent; no
Gateway credential in portable capture. 390x844, 360x780 and a reduced 390x420
viewport pass button hit-testing, visible feedback and no horizontal overflow.
The reduced viewport approximates keyboard space; it is not an actual Safari
keyboard test. Chromium is available here, WebKit and a physical iPhone are not.
Real iPhone Safari confirmation remains with the user.

All acceptance requests are reads: bootstrap=0, syncWrites=0, uploads=0.
No production API write or authenticated production read was executed, and no
existing device profile/localStorage was cleared. imports/ and runtime-data/
remain untouched. Added npm regression tests exercise the real Settings handler
with fake fetch and storage failures. No backend, permission model or runtime
worker changes, and no Gateway/wake-up restart.

Final sync9 checks: node --check passed for all 10 changed/new JavaScript files;
MULTIMODAL_MODE=text npm test: 1333 passed, 0 failed, 0 skipped.
git diff --check passed. Only the five static files below were deployed; each
local/deployed/HTTPS SHA-256 matches. Gateway remains online PID 484222, restart
count 2; wake-up remains online PID 938, restart count 0, unchanged before/after.
No push.

| Resource | Local = deployed = HTTPS SHA-256 |
| --- | --- |
| settings.html | `60c5ef88fec7cd4d7374a217c2500cfa2c41978dd83f1a255e7a67a03aacdfe1` |
| assets/css/settings.css | `f9d66278a6d3f06fc6eecc29f5dbe3a238e18cdcecf1120f80d45a3b4e8d74f1` |
| assets/js/settings.js | `5536798857ed8ac27532b44ccb81500dad4635853a47dbe44d4b6a7a55bdfb4a` |
| assets/js/personalization-sync.js | `c0417316ce10c645ab0c9b018d015749f042845b1c38d9bf6a5545aee68322d4` |
| sw.js | `ca4f70b828fd3bed72724f940fd525002a29e1f32132ccb572f868201b1ae4cb` |
