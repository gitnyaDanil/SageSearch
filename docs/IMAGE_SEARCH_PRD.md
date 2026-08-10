# SageSearch Image Search — Product Requirements Document

| Field | Value |
|---|---|
| Status | Draft for product planning |
| Date | 8 August 2026 |
| Initial platform | Windows |
| Later platform | Android |
| Initial milestone | Receipt-image search |
| Second milestone | General picture search |
| Target collection | Thousands of images per device |

This PRD is intentionally concise and designed to remain within 20 standard
pages when rendered. Unresolved decisions are recorded as open questions and do
not block the first prototype.

## 1. Executive summary

SageSearch currently helps Windows users find local files using natural-language
metadata clues. Image Search will extend it so users can find images by what is
visible inside them, even when filenames and folders are unhelpful.

Development will proceed in three stages:

1. **Windows receipt search:** recognize receipt-like images, extract visible
   text and useful receipt fields, and support natural-language filtering.
2. **Windows picture search:** find ordinary pictures using visible objects,
   visible text, and non-identifying face detection.
3. **Android port:** adapt the validated product and retrieval approach to
   Android constraints. Android is planned separately after the Windows
   experience is proven.

The product goal is not to identify one perfect result automatically. It is to
reduce a collection of thousands of images to a useful, ranked set of roughly
20–40 candidates that resembles what the user is looking for.

## 2. Problem

Images often have generated filenames, incomplete metadata, and inconsistent
folder organization. Existing SageSearch can locate an image by filename,
location, extension, or date, but cannot verify that a receipt mentions a store
or that a picture contains a particular object.

Users need to search from remembered content, such as:

- “Receipts from Toko ABC from July.”
- “Receipts containing coffee.”
- “Pictures with a bicycle.”
- “Images containing error 0x80070005.”
- “Pictures containing faces.”

Without content indexing, these memories cannot be translated into reliable
local evidence.

## 3. Product objective and success definition

### Objective

Add private, understandable image-content retrieval to SageSearch while
preserving the existing strengths of local indexing, natural-language search,
and evidence-based results.

### Primary success outcome

For representative queries over thousands of indexed images, SageSearch returns
a ranked result set of approximately 20–40 images that contains the images the
user considers relevant.

### Supporting success measures

- Users can find receipt images using visible text and baseline receipt fields.
- Users can find pictures using visible objects, visible text, and the presence
  of faces.
- Existing metadata clues can be combined with image-content clues.
- Every result states why it matched.
- Search remains available while image analysis is incomplete.
- Local mode works without uploading images.
- Cloud analysis, when available, is clearly disclosed and user-controlled.

## 4. Product principles

1. **Windows first.** Validate the complete workflow on Windows before porting
   it to Android.
2. **Receipts before general pictures.** Start with a constrained, measurable
   use case, then add broad semantic picture retrieval.
3. **Local by default.** The baseline feature runs on the device. Cloud
   processing is an optional enhancement, not a hidden dependency.
4. **Search indexed evidence.** Results must be supported by OCR text, extracted
   fields, visual similarity, detected attributes, or existing metadata.
5. **Return a useful candidate set.** Optimize for narrowing thousands of files
   to 20–40 relevant candidates, not for an unsupported claim of certainty.
6. **Explain uncertainty.** Generated captions, classifications, and extracted
   fields carry confidence and must not be presented as facts when uncertain.
7. **Do not identify people implicitly.** The initial picture milestone detects
   faces but does not recognize named individuals.
8. **Degrade gracefully.** Corrupt files, unsupported formats, disconnected
   drives, and unavailable models must not stop search or indexing.

## 5. Scope and release sequence

### Milestone 1 — Windows receipt search

In scope:

- Analyze receipt images stored in user-approved SageSearch locations.
- Run OCR and retain searchable visible text.
- Classify images as receipt-like, picture-like, mixed, or unknown.
- Extract a provisional baseline of merchant, transaction date, total,
  currency, receipt or invoice number, item keywords, and payment method when
  present.
- Search receipt content with natural language and existing metadata clues.
- Show receipt fields and OCR snippets as match explanations.
- Support local analysis and a separately enabled cloud-analysis path.

### Milestone 2 — Windows general picture search

In scope:

- Search for common objects and scenes using semantic visual retrieval.
- Search visible text in pictures, screenshots, signs, whiteboards, and memes.
- Filter by whether faces are detected and, when reliable, approximate face
  count.
- Combine visual evidence with filename, folder, date, extension, and location.
- Use the same ranked-result and explanation experience as receipt search.

Image-to-image similarity is a candidate enhancement for this milestone. It is
not a release requirement until its user experience is validated.

### Milestone 3 — Android port

In scope for planning:

- Reuse the validated search vocabulary, result explanations, evaluation data,
  and model-provider interfaces where practical.
- Adapt ingestion, storage permissions, background work, battery usage, model
  size, and hardware acceleration for Android.
- Define Android as a separate delivery plan rather than forcing the Windows
  implementation to share platform-specific code.

Whether Android searches only device-local media or a synchronized cross-device
index remains an open decision.

## 6. Users and jobs to be done

The initial user persona is intentionally broad until user research identifies
the strongest segment.

Core jobs:

- When I remember a store, date, amount, or item from a receipt, help me find
  the receipt without remembering its filename.
- When I remember an object or visible phrase in a picture, reduce my image
  library to a manageable set of likely matches.
- When results are uncertain, show why each image was selected so I can decide
  quickly.
- When I prefer privacy or have no internet connection, let me search using
  local analysis.
- When local accuracy is insufficient, let me explicitly request cloud help and
  understand what will be uploaded.

## 7. User experience

### 7.1 First-run image analysis

1. The existing metadata scan completes as quickly as it does today.
2. Supported images enter a separate, resumable content-analysis queue.
3. SageSearch displays image-analysis progress independently from file-indexing
   progress.
4. Users can search immediately; the UI states when content results may be
   incomplete.
5. Analysis resumes after restart and skips unchanged images.

The privacy notice must explain that local image analysis reads image pixels and
stores derived OCR text, fields, labels, and vectors on the device. This replaces
the current absolute claim that files are never read.

### 7.2 Receipt search

Example query:

> Find receipts from Toko ABC in July containing coffee.

Expected behavior:

1. Interpret receipt type, merchant, date range, and item or OCR term.
2. Apply reliable structured filters and existing metadata constraints.
3. Search OCR text for exact and partial matches.
4. Add semantic candidates when exact retrieval is insufficient.
5. Return up to 40 ranked results, with the strongest 20 shown initially if
   needed for scanning speed.
6. Explain each match, for example: “Merchant Toko ABC; OCR contains coffee;
   transaction date 18 July 2026.”

If the meaning of a date is ambiguous, the explanation must identify whether
SageSearch used transaction date, file-created date, or modified date.

### 7.3 General picture search

Example query:

> Pictures containing a bicycle and visible text saying Bandung.

Expected behavior:

1. Interpret the object and OCR clues without converting them into filename
   keywords.
2. Retrieve visual candidates for the object.
3. Search OCR text for the visible phrase.
4. Combine both candidate lists with metadata constraints.
5. Explain whether the result matched visual similarity, OCR, metadata, or a
   combination.

### 7.4 Face detection

The first picture release supports:

- contains one or more faces;
- contains no detected faces;
- approximate face count only when confidence is sufficient.

It does not attach identities, infer sensitive traits, or search for named
people. Named-person search requires a future consent and biometric-data design.

### 7.5 Broad, empty, and partial results

- **Broad query:** show a ranked preview and ask one useful narrowing question.
- **No results:** state which evidence was searched and suggest one refinement.
- **Analysis incomplete:** return available results and show progress.
- **Low-confidence image:** search both OCR and visual signals; label the image
  mixed or unclassified rather than hiding it.
- **Disconnected drive:** retain indexed information but mark results
  unavailable, following current SageSearch behavior.

## 8. Functional requirements

| ID | Requirement | Priority | Release evidence |
|---|---|---|---|
| FR-01 | Discover supported images only in user-approved locations. | Must | No out-of-scope path is analyzed or returned. |
| FR-02 | Analyze images in a separate resumable background queue. | Must | Search remains responsive during analysis and jobs resume after restart. |
| FR-03 | Run OCR on every supported image. | Must | Visible text is searchable in receipts and pictures. |
| FR-04 | Classify receipt-like, picture-like, mixed, and unknown content with confidence. | Must | Low-confidence images remain retrievable. |
| FR-05 | Extract baseline receipt fields without discarding raw OCR evidence. | Must | Merchant, date, total, currency, receipt number, item keywords, and payment method are indexed when present. |
| FR-06 | Combine content clues with existing metadata filters. | Must | Location, date, type, extension, and filename can narrow image results. |
| FR-07 | Return a ranked set capped at 40 by default. | Must | Thousands of files are narrowed to a manageable candidate set. |
| FR-08 | Show an evidence-based match explanation per result. | Must | Result cards identify OCR, field, visual, and metadata evidence. |
| FR-09 | Support fully local image indexing and retrieval. | Must | Core receipt search works offline after models are installed. |
| FR-10 | Keep cloud image analysis separately disabled until explicitly enabled. | Must | Cloud query interpretation does not authorize image upload. |
| FR-11 | Detect the presence of faces without identity recognition. | Must for Milestone 2 | Queries can include contains-faces while no biometric identity is stored. |
| FR-12 | Search common objects through semantic visual retrieval. | Must for Milestone 2 | Evaluation queries retrieve relevant object-containing pictures in the top 40. |
| FR-13 | Avoid reanalyzing unchanged files. | Must | Content hashes and model versions control invalidation. |
| FR-14 | Remove all derived data when a file or location is removed. | Must | Metadata, OCR, fields, vectors, thumbnails, and jobs are deleted together. |
| FR-15 | Allow failed image jobs to be retried or rebuilt. | Should | Settings exposes aggregate errors and a safe reanalysis action. |
| FR-16 | Support image-to-image similarity. | Could | A selected image can retrieve visually similar indexed images. |

## 9. Search and ranking model

SageSearch will use hybrid local retrieval rather than relying on one model.

### Candidate sources

- existing SQLite metadata search;
- full-text search over OCR and normalized receipt text;
- exact structured receipt filters;
- visual vector similarity for objects and scenes;
- optional captions or labels as lower-confidence supporting evidence.

### Ranking approach

1. Apply hard constraints, such as approved location, file availability, date,
   extension, and reliable receipt amounts.
2. Generate candidates independently from structured fields, full text, and
   vectors.
3. Combine ranked lists using a scale-independent method such as reciprocal-rank
   fusion.
4. Boost exact field and OCR matches above weaker generated descriptions.
5. Cap the default result set at 40 and retain evidence for explanations.

The first release should optimize and evaluate Recall@40. Precision within the
first 20 results is a secondary measure because the user should see the strongest
candidates first.

## 10. Local and cloud processing

### Local mode

Local mode is the provisional default. Image pixels, OCR, extracted fields,
captions or labels, embeddings, filenames, paths, and results stay on the device.
It must support the core receipt workflow without network access after required
models are available.

### Cloud mode

Cloud processing is an optional accuracy path. It may be invoked for selected
images, low-confidence extraction, or an explicitly enabled background mode,
depending on later product decisions.

Before upload, the UI must state:

- which provider receives the image;
- what is sent;
- why it is needed;
- whether results are retained by the provider;
- expected cost or quota impact;
- how the user disables the feature.

Cloud query interpretation and cloud image analysis are separate permissions.
Paths, unrelated metadata, local index rows, and search results must not be sent
unless a future feature explicitly requires and discloses them.

## 11. Conceptual data and system design

The existing `files` table remains the source of truth for file identity and
availability. New local stores add:

- analysis-job state;
- content hash and model versions;
- content kind and confidence;
- OCR text and confidence;
- normalized receipt fields with source evidence;
- object, scene, and face-presence signals;
- multimodal image vectors;
- bounded local thumbnails.

Provisional technology direction:

- OCR and receipt layout: PaddleOCR or an interchangeable local OCR provider;
- visual retrieval: a multilingual SigLIP 2 family encoder or equivalent;
- text search: SQLite FTS5;
- initial vector storage: a local vector extension behind a replaceable
  `VectorStore` interface;
- acceleration: ONNX/Windows ML where compatible;
- cloud enrichment: provider-neutral structured vision output.

Models must not receive filesystem or search-tool access. Workers return
validated, versioned data contracts rather than writing arbitrary model output
directly into search tables.

## 12. Non-functional requirements

### Performance

- Target collections contain thousands of images, with 10,000 images used as
  the initial performance test size.
- Provisional warm-query target: results begin rendering within two seconds on
  representative mid-range Windows hardware after indexing.
- Background analysis must not block metadata search or opening results.
- Interactive query encoding takes priority over background analysis.
- Concurrency adapts conservatively to memory, battery, and accelerator
  availability.

These latency and indexing targets require validation and may change after the
prototype benchmark.

### Reliability

- Analysis jobs survive application restart.
- Corrupt or unsupported files receive stable error states and do not block the
  queue.
- Derived records are committed transactionally or remain retryable.
- Model upgrades invalidate only affected derived outputs.
- Original image files are never modified.

### Privacy and security

- Analyze only canonical paths currently present in approved locations.
- Use bounded decoding to reduce malformed-image and decompression risks.
- Keep the renderer behind a narrow API with no unrestricted filesystem access.
- Delete derived data when the source file or location is removed.
- Do not collect named face embeddings in the planned releases.
- Avoid including local paths, OCR text, or image content in telemetry.

### Accessibility and clarity

- Progress and status are available without relying on color alone.
- Match explanations use plain language.
- AI-derived values visibly distinguish high and low confidence.
- Keyboard navigation remains available for search and results.

## 13. Evaluation plan

Create a consented, representative test collection containing:

- receipts from different merchants, languages, currencies, lighting, angles,
  and image quality;
- ordinary pictures with common objects and scenes;
- screenshots, signs, whiteboards, and mixed text-picture content;
- images with zero, one, and multiple faces;
- duplicates, rotated files, unsupported formats, and corrupt files.

Measure:

- query Recall@40 and precision in the first 20 results;
- percentage of evaluation tasks successfully narrowed to 20–40 useful images;
- OCR accuracy by supported language;
- merchant, transaction date, total, currency, and item extraction accuracy;
- face-presence detection accuracy without identity processing;
- warm and cold query latency;
- analysis throughput, peak memory, and battery impact;
- restart recovery and deletion completeness.

Qualitative review must verify that explanations match actual indexed evidence.

## 14. Release plan and gates

Implementation snapshot (2026-08-08): the local Windows queue, durable schema,
Windows OCR bridge, FTS retrieval, receipt heuristic/fields, progress and retry
UI, restart recovery, deletion cleanup, and analysis-version invalidation are in
the `codex/image-search` branch. A single-image Android Photo Picker + bundled
on-device OCR risk spike and CI APK workflow are also scaffolded. Formal receipt
evaluation, Windows packaging, full Android library indexing, object retrieval,
and face-presence detection remain pending.

### Phase A — Technical prototype

- Build the separate analysis queue and local schema.
- OCR a small receipt set and search raw visible text.
- Establish a baseline evaluation set and performance benchmark.

Gate: OCR search works locally without slowing existing metadata search.

### Phase B — Windows receipt alpha

- Add receipt classification and baseline field extraction.
- Add natural-language receipt filters, ranking, explanations, and progress UI.
- Validate local/cloud boundaries and deletion behavior.

Gate: representative receipt tasks achieve acceptable Recall@40 and field
accuracy, with no undisclosed upload.

### Phase C — Windows picture beta

- Add object-oriented semantic retrieval, picture OCR, and face presence.
- Tune hybrid ranking over thousands of images.
- Evaluate model size, installation, performance, and false positives.

Gate: picture tasks reliably reduce the test collection to 20–40 useful
candidates with understandable explanations.

### Phase D — Android discovery and port plan

- Use the single-image Photo Picker + on-device OCR prototype as an early quality
  and device-compatibility spike; this does not move full Android library indexing
  ahead of Windows receipt-search validation.
- Validate target Android user and storage scope.
- Benchmark candidate models and databases on representative phones.
- Decide whether search is device-local, synchronized, or both.
- Use and maintain the separate
  [`ANDROID_IMAGE_SEARCH_SPEC.md`](ANDROID_IMAGE_SEARCH_SPEC.md) delivery and
  architecture guide.

## 15. Out of scope for the planned Windows releases

- Named-person or biometric identity search.
- Inference of age, ethnicity, health, emotion, or other sensitive traits.
- Automatic upload of images merely because cloud query interpretation is on.
- Automatic indexing outside user-approved locations.
- Editing or reorganizing original image files.
- Guaranteed accounting-grade receipt extraction.
- Cross-device synchronization before the Android product decision.
- Video-content search.

## 16. Key risks and mitigations

| Risk | Impact | Initial mitigation |
|---|---|---|
| Receipt diversity and poor image quality | Incorrect fields or missed receipts | Preserve raw OCR, store confidence, evaluate diverse samples, and allow refinement. |
| Broad visual queries | Too many weak matches | Combine vector retrieval with OCR, metadata, and one targeted refinement. |
| Local model size and speed | Slow installation or indexing | Use staged model downloads, bounded inputs, low concurrency, and hardware-aware acceleration. |
| Cloud privacy confusion | Loss of user trust | Separate query and image permissions; disclose provider and payload before upload. |
| Face false positives | Misleading filters | Treat face count as approximate, expose confidence, and avoid identity claims. |
| Model changes | Expensive full reindexing | Version each derived signal and reanalyze only affected outputs. |
| Android constraints | Battery, storage, and background limits | Plan Android after Windows validation and benchmark independently. |

## 17. Open questions

These decisions are intentionally deferred:

1. Which user segment should drive Windows receipt-search positioning?
2. Which baseline receipt fields are genuinely useful, and which are sensitive
   or unnecessary?
3. Should the primary UX be natural language only, natural language plus visible
   filters, or natural language with suggested filter chips?
4. When should SageSearch offer cloud analysis, and can it ever run in the
   background rather than per selected image?
5. Which cloud provider, data-retention policy, pricing model, and user quota are
   acceptable?
6. What Windows image formats and languages are required at launch?
7. What indexing duration, model download size, and minimum hardware are
   acceptable?
8. Is image-to-image similarity required for the second milestone?
9. Should Android search only phone-local media or a synchronized Windows
   library?
10. What consent, enrollment, storage, and deletion model would be required
    before named-person search is considered?

## 18. Windows release acceptance criteria

The planned Windows scope is ready for release when:

- A new user can enable image analysis and understand the privacy implications.
- SageSearch indexes thousands of approved images without blocking ordinary file
  search.
- Receipt queries search visible text and validated receipt fields.
- General picture queries search visible objects, visible text, and face
  presence.
- Representative evaluation queries return no more than 40 default candidates
  and achieve the agreed Recall@40 threshold.
- The strongest 20 results are ordered usefully enough for rapid review.
- Every result provides an evidence-based match explanation.
- Local mode operates offline after setup.
- Cloud image analysis cannot occur without separate user authorization.
- Failed jobs resume safely, missing drives remain understandable, and removal
  deletes derived data.
- Named-person recognition and other excluded sensitive inferences are absent.
