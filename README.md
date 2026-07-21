# SageSearch — AI File Finder

> Find local files using plain language. Your file index and results stay on your device.

---

## Quick Start (No Terminal Needed)

1. Choose `provider.mode` in `backend/config.json`: `local` for LM Studio or `cloud` after deploying the Cloud Run proxy.
2. For local mode, enable LM Studio's local server: **Developer tab → Enable Local Server**
3. Double-click **`Start SageSearch.bat`**
4. Your browser opens automatically at `http://localhost:3001`

That's it. 🎉

---

## What You Can Say

| Example prompt | What happens |
|----------------|-------------|
| *"Find all PDFs from last week"* | Searches all folders for recent PDFs |
| *"Show me videos in Downloads"* | Filters by folder + file type |
| *"Find screenshots from yesterday"* | Date-filtered image search |
| *"Audio files named recording"* | Keyword + type combined |
| *"Excel files from this month"* | Document type + date range |
| *"Show presentations in SSD HP"* | PowerPoint-compatible file formats in that location |

---

## How It Works

```
Your prompt
    │
    ▼
SageSearch Backend (localhost:3001)
    │  calls ▼
LM Studio (localhost:1234)  ← Gemma 4 E4B, runs on your machine
    │  tool call ▼
local SQLite index           ← scans locations in the background
    │  returns metadata ▼
AI writes a summary
    │
    ▼
File cards appear — click "Show in Explorer"
```

**Your files are never read, uploaded, or shared.**
In local mode, nothing leaves your device. In cloud mode, only the typed search
phrase, current date, and a fixed search vocabulary are sent for interpretation.
File names, paths, metadata, and results remain local in both modes.

---

## Search Locations

| Folder | Path |
|--------|------|
| Documents | `C:\Users\<you>\Documents` |
| Downloads | `C:\Users\<you>\Downloads` |
| Desktop   | `C:\Users\<you>\Desktop`   |
| Pictures  | `C:\Users\<you>\Pictures`  |
| Videos    | `C:\Users\<you>\Videos`    |
| Music     | `C:\Users\<you>\Music`     |

SageSearch indexes these default locations on first launch. Use the **+** beside
Search Locations to add any folder or a removable-drive root (for example `E:\`).
Each location shows whether it is indexing, ready, or disconnected. You can
refresh or remove a location from the sidebar.

Searches read the local SQLite index rather than walking folders at query time.
If a removable drive is unplugged, its previous results stay visible and are
marked **Unavailable** until the drive reconnects.

---

## File Types Supported

| Category | Extensions |
|----------|-----------|
| Document | .pdf .docx .xlsx .pptx .txt .csv .md … |
| Image    | .jpg .png .gif .bmp .webp .heic … |
| Video    | .mp4 .mkv .avi .mov .wmv .webm … |
| Audio    | .mp3 .wav .flac .aac .ogg .m4a … |

---

## Interpret Search Providers

Every provider receives a search phrase, today's date, and a fixed vocabulary.
It returns only validated filters: file type, file-format extensions, filename keywords, location label,
created/modified date range, unsupported clues, and at most one clarifying
question. The backend then runs the SQLite search itself. Providers never
receive file names, paths, index rows, result counts, or document content.

`backend/config.json` selects the provider:

```json
{
  "provider": {
    "mode": "cloud",
    "local": {
      "endpoint": "http://localhost:1234",
      "model": null
    },
    "cloud": {
      "proxyUrl": "https://YOUR-CLOUD-RUN-URL/interpret"
    }
  }
}
```

- `local` uses the configured LM Studio OpenAI-compatible endpoint. Nothing is sent off-device.
- `cloud` posts to the SageSearch Cloud Run proxy, which can call DeepSeek with its server-side credential. Only the typed search phrase leaves the app; local metadata and results remain local.

Cloud mode requires a deployed proxy URL in `backend/config.json`. The proxy
holds its provider credential in Secret Manager and applies request validation
plus a conservative rate limit. Do not commit provider credentials or an
active shared demo endpoint to a public repository.

Deploy the service in `cloud-proxy/` using its README. The DeepSeek key is a
Cloud Run Secret Manager value, never desktop-app configuration or source code.

## Configuration

Edit `backend/config.json` to change the LM Studio port if needed:

```json
{
  "lmStudio": {
    "host": "localhost",
    "port": 1234
  }
}
```

The development index is stored locally at `backend/data/sagesearch.sqlite` and contains only
file metadata: filename, path, extension/type, size, created date, modified date,
and source location. Electron should launch the backend with `SAGESEARCH_DATA_DIR`
set to Electron's per-user `app.getPath('userData')`, so installed updates never
overwrite the user's index. Delete the database file to rebuild the index from scratch.

## Built with Codex and GPT-5.6

Codex, powered by GPT-5.6, helped shape SageSearch into a simple, private file
finder. Together, we designed **SageSearch Cloud** to understand the user's
typed request while SageSearch searches the local SQLite index.

SageSearch Cloud receives only the search phrase. File names, folder paths,
metadata, document contents, and search results stay on the user's computer.

Supporting documents:

- [Principles and architecture](https://github.com/gitnyaDanil/SageSearch/blob/main/docs/PRINCIPLES_AND_ARCHITECTURE.md)
- [Codex feedback and demo narration](https://github.com/gitnyaDanil/SageSearch/blob/main/docs/CODEX_FEEDBACK.md)

---

## Principles

1. 🔒 **Privacy First** — File contents and metadata stay local; cloud mode sends only the typed search phrase
2. ⚡ **Customer Experience** — Fast results, clear errors, familiar UI
3. 📈 **Growth** — Works for anyone, zero setup friction

---

## Requirements

- Windows 10 or 11
- [Node.js v22.5+](https://nodejs.org/)
- [LM Studio](https://lmstudio.ai/) with any chat model loaded
