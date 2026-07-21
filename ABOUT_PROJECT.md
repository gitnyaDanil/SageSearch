## Inspiration

SageSearch started with a question about how people will work with their computers in the future. As software becomes better at understanding intent, many everyday tasks can begin with a request rather than a sequence of clicks through folders and menus.

File search is a personal example of this problem. I keep several resume versions tailored for different companies and roles. Over time, they become mixed with unrelated documents, stored deep inside folders, or duplicated across multiple locations. Finding the right version can take longer than updating it.

General purpose agent tools can search local files, but this can be inefficient. A search may consume a limited context window, take time while inspecting irrelevant folders, and lose track of the original goal during a long exploration. Traditional file search has the opposite problem: it expects people to remember exact filenames, locations, or filters.

SageSearch was built to bridge this gap. It lets people describe the document they need in ordinary language, then searches a persistent local index instead of exploring the entire filesystem from scratch each time.

## What it does

SageSearch helps users find local files from contextual clues such as file type, filename words, folder, and modified date.

For example, a user can ask:

> Find the latest resume for a freelance application.

SageSearch translates the request into supported filters, searches locally, and returns matching files. It can search documents, images, videos, audio files, and other indexed file types. Users can add search locations, revisit recent searches, open a result, or reveal it in its folder.

Privacy is central to the product. File names, paths, contents, indexed records, and search results stay on the device. The final search always runs against a local SQLite database.

## How we built it

We built SageSearch as a local first web application.

1. The frontend provides a simple search interface, recent searches, search location management, result cards, and settings.

2. The Node.js backend scans selected folders and stores local metadata, including file name, extension, folder, and modified date, in a SQLite index.

3. An interpretation layer converts natural language requests into a small, validated set of search filters. The backend performs the search itself, so the interpretation layer never receives access to local files or search results.

SageSearch supports a local model through LM Studio and an optional cloud interpretation service. In cloud mode, only the typed search request and a limited vocabulary are used. Local file metadata and results remain on the device in both modes.

## Challenges we ran into

One challenge was turning an early idea into a focused product. We brainstormed several possible directions, then validated that the strongest use case was not broad computer control but quick, understandable, private file search. This required deliberate design decisions about what SageSearch should search and, equally importantly, what it should not claim to know.

We also faced normal development challenges. Indexing folders without blocking search, handling different file extensions, connecting the interface to the local backend, and resolving bugs around search filters all required iteration. We had to ensure that a vague request still produced predictable results rather than an overly broad or confusing search.

The most important technical challenge was privacy and reliability. We limited interpretation to validated metadata filters so that the system cannot widen its own search access. SageSearch does not search document contents, senders, file open history, or any other signals that are not indexed.

## Accomplishments that we're proud of

We are proud that SageSearch makes an everyday problem feel simpler without asking users to reorganize their entire filesystem first.

We are also proud of the local first architecture. The application keeps file names, paths, metadata, and search results on the user’s device while still allowing a natural search experience. The local SQLite index makes repeated searches faster and more reliable than exploring folders from scratch.

Finally, we are proud of the product boundaries. SageSearch clearly communicates what it can search, uses only supported clues, and avoids pretending to understand information it cannot verify.

## What we learned

We learned that a useful search product needs more than good request interpretation. It must be fast, predictable, private, and honest about its limits.

We also learned that people often remember context rather than exact details. They may remember that a document was a spreadsheet, was edited last week, or was related to a job application. Converting these memories into useful local filters can remove a great deal of friction.

The project also taught us the value of narrowing scope. By focusing on local file metadata and a small set of reliable filters, we could build a more trustworthy experience than attempting to solve every possible search request at once.

## What's next for SageSearch

We did not have time during the hackathon to build every platform and integration we envisioned. Next, we want to bring SageSearch to mobile devices and macOS so more people can use the same private search experience across their devices.

We also plan to integrate SageSearch with agent harnesses. This would let an agent request a fast, scoped local search through SageSearch instead of repeatedly inspecting folders and files. The integration could preserve the agent’s context while keeping search controlled and efficient.

Before reaching more people, we want to make SageSearch production ready. That includes improving installation, strengthening indexing performance, expanding test coverage, improving error handling, refining the interface, and making privacy controls easier to understand.

Our long term goal is to make file search feel as natural as asking for the document you need, while keeping control of personal files with the person who owns them.
