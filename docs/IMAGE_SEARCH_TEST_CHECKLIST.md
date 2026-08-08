# Image Search Test Checklist

Use this checklist for the first receipt-search feedback session. Test with
copies of images that do not contain sensitive payment details.

## Windows vertical slice

1. Work from `C:\Users\Daniel\Documents\SageSearch-image-search` on branch
   `codex/image-search`.
2. Put a clear JPG or PNG receipt in Pictures, Downloads, or another indexed
   location.
3. Start SageSearch with `Start SageSearch.bat`.
4. Wait for image analysis to finish. To move one image to the front, find it
   by filename and use the sparkle action on its result card.
5. Try these searches:
   - `Find receipts containing total`
   - `Find receipts containing <an item printed on the receipt>`
   - `Receipts from <merchant name>`
   - `Find a receipt named <filename> containing <visible text>`
6. Confirm the matching card shows a receipt badge, visible-text excerpt, and
   plausible merchant/date/total candidates.
7. If a transient OCR error appears, use **Retry failed image analysis**. An
   unsupported format should display its actual limitation instead of claiming
   it was queued.

Initial Windows OCR formats are JPG/JPEG, PNG, BMP, and TIFF. Recognition uses
the OCR languages installed in Windows.

## Android prototype

### Android Studio

1. Open the repository's `android` directory in current Android Studio.
2. Use JDK 17 and install Android SDK 37 when prompted.
3. Run the `app` configuration on an API 23+ device or emulator.
4. Tap **Choose an image**, select one clear receipt, and compare the displayed
   text and receipt fields with the original.

### GitHub Actions APK

Pushing `codex/image-search` automatically runs **Android prototype**. Its
`sagesearch-image-test-debug` artifact contains `app-debug.apk`; unit tests and
Android lint run before the APK is published. Manual Actions-tab dispatch becomes
available after the workflow file also exists on the default branch.

The Android prototype currently validates one selected image. It does not yet
index or search the phone's entire media library.

## Record feedback

For every image, record:

| Field | Result |
|---|---|
| Platform/device | |
| Image format and orientation | |
| Receipt vs picture result | |
| Important visible text found/missed | |
| Merchant candidate | |
| Date candidate | |
| Total and currency candidate | |
| Approximate analysis time | |
| Unexpected behavior | |

Start with several clean receipts, then add rotated, low-light, long, wrinkled,
and mixed Indonesian/English examples. This will separate OCR-quality problems
from receipt-rule problems before full-library indexing is implemented.
