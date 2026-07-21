# SageSearch Principles and Architecture

## Product purpose

SageSearch helps Windows users find a document when they remember its context
but not its filename or location.

> “I remember it was a Word document I made last week, probably in my project
> folder.”

SageSearch turns that memory into a fast local search. It does not claim to
know facts that have not been indexed.

## Product principles

1. **It just works for consumers.** Install, choose (or accept) search
   locations, and search. A consumer must not need Node.js, a terminal, an API
   key, or a locally running model.

2. **Search locally; use AI only to understand intent.** The file index,
   retrieval, ranking, and file-opening actions run on the user's computer.
   AI interprets the user's sentence into structured filters.

3. **Be precise about privacy.** SageSearch Cloud may receive the user's
   search phrase, but it must never receive file names, paths, index rows,
   search results, or document contents. Local AI mode sends nothing off the
   device. Privacy language must name these boundaries plainly.

4. **Be honest about evidence.** A result must be explainable by local indexed
   metadata: filename, path, file type, file size, created date, or modified
   date. Sender, document topic, document text, and file-open history are not
   searchable until those signals are explicitly added.

5. **Search before asking.** If a query contains at least one reliable,
   supported clue, search immediately. Ask one targeted follow-up only when
   results are empty, exceed 30 candidates, or rely on an unsupported clue.

6. **Keep the main interaction minimal.** The main UI is a launcher-like
   search field, concise status, and file results. Provider setup, API keys,
   local models, and detailed configuration belong in Settings.

7. **Make Windows behavior feel native.** Support configurable folders,
   removable-drive roots, opening a file, revealing it in Explorer, and a
   configurable global shortcut. Do not hard-code `Alt+Space`; it conflicts
   with common Windows behavior and other launcher tools.

8. **Degrade gracefully.** A missing drive is shown as disconnected. A cloud
   outage does not destroy the local index. A model that cannot interpret a
   query produces a clear question or a basic metadata search, never a
   fabricated answer.

## Supported search meaning in version one

| What the user says | SageSearch action |
|---|---|
| “I made it last week” | Filter by the file's created date. |
| “I updated it last week” | Filter by the file's modified date. |
| “PDF in Downloads” | Filter by type and configured location. |
| “Called budget” | Match the filename and path tokens. |
| “Sarah sent me the proposal” | Explain that sender and document text are not indexed; search any supported clues and ask for the most useful next detail. |
| “I opened it last week” | Do not silently map this to modified date. Explain that open history is not yet available and offer modified date only as an explicit approximation. |

## User experience

### First run

1. SageSearch starts indexing standard Windows folders in the background.
2. The user can search while indexing and can add folders or removable drives
   in Settings.
3. A short privacy notice explains the selected intelligence mode:
   - **SageSearch Cloud:** the search phrase is processed in the cloud; local
     file metadata and contents remain local.
   - **Local AI:** the user connects a compatible local endpoint, such as LM
     Studio; nothing leaves the device.

### Search flow

1. The user enters a natural-language request.
2. The selected intelligence provider returns structured filters, unsupported
   clues, and optionally one clarification question.
3. SageSearch validates the response and queries the local SQLite index.
4. If the result set is useful (30 files or fewer), it displays results with a
   compact explanation of the filters applied.
5. If the set is too broad, empty, or depends on missing information,
   SageSearch asks one high-value question and refines the existing search.
6. The user opens the file or reveals it in Explorer.

The app must not present a large unranked “show all” collection as a substitute
for a useful clarification.

## Target architecture

```text
Electron renderer
  └─ Minimal search UI and Settings
       │ IPC
Electron main process
  ├─ Search service
  │    └─ SQLite index in the per-user application-data directory
  ├─ Location service
  │    └─ Windows folders, user-selected paths, removable-drive status
  ├─ Shell service
  │    └─ Open file / reveal in Explorer / global shortcut
  └─ Intent-provider interface
       ├─ SageSearch Cloud provider
       │    └─ Cloud Run proxy → model provider
       └─ Local provider
            └─ User-configured OpenAI-compatible endpoint (for example LM Studio)
```

The Electron renderer never receives unrestricted filesystem or secret access.
It uses a narrow preload/IPC API. The cloud API key is never embedded in the
desktop app.

### Local index

SQLite is the source of truth for retrieval. It stores metadata only:

- location identifier and availability state
- filename and full path
- extension and category
- size
- created and modified timestamps
- index timestamp and file count per location

The index lives under Electron's user-data directory, not the installation
directory. Indexing is asynchronous and reports `indexing`, `ready`, or
`disconnected` status. File-system changes should eventually be handled by a
watcher plus periodic reconciliation; a rescan must always be available.

### Intent-provider contract

An AI provider receives only the search phrase, current date, and the allowed
search vocabulary. It returns validated JSON similar to:

```json
{
  "filters": {
    "keyword": "budget",
    "fileType": "document",
    "folder": "Documents",
    "dateField": "created",
    "dateAfter": "2026-07-13",
    "dateBefore": "2026-07-19"
  },
  "unsupportedClues": [],
  "clarifyingQuestion": null
}
```

SageSearch validates every field against its schema before querying SQLite.
The provider does not call local search tools and does not receive file results.

### SageSearch Cloud

SageSearch Cloud is the default consumer mode. A small Cloud Run service:

1. accepts a bounded interpretation request;
2. applies authentication, quota, and abuse controls;
3. calls the selected model provider with a strict JSON schema;
4. returns only the validated interpretation.

The model-provider credential is stored server-side in a secret manager. Public
distribution must not expose an unauthenticated proxy or an embedded shared API
key.

### Local AI

Local AI is an advanced Settings option. Users provide a compatible local
endpoint and select a model. SageSearch uses the same intent-provider contract,
so local and cloud modes produce identical local search behavior.

## Explicit non-goals for the hackathon build

- Reading or indexing document content
- Searching email sender/recipient data
- System-wide file-open history
- macOS support
- Automatic indexing of every drive without user selection
- Document previews
- User-created memory labels
- Multiple cloud providers and full account/billing management

## Hackathon definition of done

A judge can install a Windows build, choose or accept local search folders,
enter a natural-language request without configuring a local model, receive
relevant local results, and open or reveal the selected document. The demo must
state exactly what remains local and what SageSearch Cloud receives.
