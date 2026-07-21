# SageSearch roadmap

## Later improvement: local file preview and details pane

Add a Windows Explorer-style pane on the right when a user selects a search
result. It should show the file name, path, type, size, dates, source location,
and Open / Show in Explorer actions.

Recommended first scope (3–5 workdays):

- Render local image previews and browser-native PDF previews.
- Keep file contents on the user's computer; no Cloud Run or DeepSeek request
  is needed for a preview.
- Serve previews only for a selected, indexed local file and show a clear
  unavailable state for disconnected drives or unsupported formats.
- Limit preview dimensions and use a small local thumbnail cache if needed.

Later scope:

- Native audio and video controls (2–3 additional workdays).
- Word, Excel, and PowerPoint preview rendering (8–15 additional workdays).
  This needs a local conversion strategy and should not be added to the first
  release because it increases installer size and complexity.
