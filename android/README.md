# SageSearch Android image-search prototype

This is the first Android vertical slice. It lets a tester choose one image with
Android's Photo Picker, runs bundled ML Kit Latin-script OCR on the device, applies
the same receipt-oriented rules as the Windows prototype, and displays:

- receipt or picture classification;
- receipt confidence;
- detected visible text;
- merchant/date/total candidates when available.

For this early validation, `picture` means that the receipt rules found
insufficient receipt evidence. Object labels, scene classification, and faces
are intentionally not claimed yet.

It does not upload images, request full photo-library permission, persist an index,
or search thousands of images yet. Those capabilities belong to the next Android
milestone after this single-image validation.

## Run it

1. Install current Android Studio with Android SDK 37 and JDK 17.
2. Open the `android` directory as a project.
3. Allow Gradle sync to download the Android and ML Kit dependencies.
4. Run `app` on an Android 6.0 (API 23) or newer emulator/device.
5. Tap **Choose an image** and select a clear, upright receipt.

From a Windows terminal configured with Android Studio's JDK and SDK, the same
verification can be run with:

```powershell
cd android
.\gradlew.bat testDebugUnitTest lintDebug assembleDebug
```

The debug APK is written to `android/app/build/outputs/apk/debug/app-debug.apk`.
Install it on a connected test device with `adb install -r` if USB debugging is
already enabled and the device is authorized.

Pushing `codex/image-search` automatically starts the **Android prototype**
GitHub Actions workflow. It runs the unit tests and lint, builds `app-debug.apk`,
and publishes it as the `sagesearch-image-test-debug` workflow artifact for seven
days. Once the workflow file also exists on the default branch, it can be started
manually from GitHub's Actions tab.

The bundled OCR dependency increases the APK size but makes the first recognition
available immediately and keeps this prototype independent of a model download.

## Next Android milestone

Add user-approved library ingestion through MediaStore, a persistent Room index,
background WorkManager jobs, full-text search, progress/retry UI, and shared receipt
heuristic fixtures so Windows and Android can be compared against the same examples.

## Build baseline

- Android Gradle Plugin 9.3.0
- Kotlin / Compose compiler plugin 2.3.21
- Compose BOM 2026.06.00
- ML Kit bundled text recognition 16.0.1
- Minimum API 23; compile/target API 37
