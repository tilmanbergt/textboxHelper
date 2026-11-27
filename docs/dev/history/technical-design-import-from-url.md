# Technical design: Import from URL

Branch `feature/import-from-url`. Download a text document from a URL, save it as a `.txt` file,
then open the existing Import screen on that file. Everything after the download (preview, linked
import, Outline, write-back) is today's import, unchanged.

## 0. Decisions (from the requirements discussion)

| # | Decision |
|---|---|
| R1 | Download first, then the normal import. No "URL source" kind; the saved `.txt` is an ordinary file. |
| R2 | Network only in this one action: one GET of the typed URL when the user taps Download. Nothing from the device is sent beyond the HTTP request itself; no open connection, no background work, no polling. |
| R3 | INTERNET is asked right before the download, never at start; a grant is remembered for the session. |
| R4 | Accepted: `text/plain`, `text/markdown`, `text/x-markdown`, and no Content-Type when the body is UTF-8 text. Everything else (also `text/html`) is refused with a message. |
| R5 | `http://` and `https://` both allowed (no extra cost). A URL without a scheme gets `http://`. |
| R6 | The last 5 URLs (newest first) and the last target folder are remembered in `settings.json`. Recent URLs can be **edited** (into the field) and **removed**. |
| R7 | No name preview before the download (it would need a second request). |
| R8 | Every download is a new file; an existing name gets the `copyPath` suffix. Re-download into an already linked file ("Reload") is later work. |
| R9 | Frontmatter is saved unchanged; the import keeps it as it does for Obsidian files (`sourceBlocks.ts`). |
| R10 | The entry sits in the Files tab under "Into this note", after the existing entries, on empty and non-empty notes alike. |

## 1. Screens

**Files tab** (`screens/manuscript/files/FilesTab.tsx`): a new `TextLink` "Import from URL ›" under
"Into this note" in the unlinked and the linked-files branch (in the linked branch the downloaded
file is then added like "Add a file"). Not shown while the note is bound to a folder (new files come
from the folder there). Hint: "A text or Markdown file from your network, e.g. VoiceDraft."

**Import from URL** (`screens/import/UrlImportScreen.tsx`, sub-screen of the card, `view: 'url'`):

- **URL** field (`TextInput`, `keyboardType="url"`, no autocorrect/autocapitalize).
- **Recent** (`PagedSection`, ≤ 5 rows): tap = put into the field; per row a small `Edit` (into the
  field, focused) and `✕` (remove, saved at once). Empty list: no section.
- **Save to**: folder name + "Change ›" (§4.4). Hint line: "Saved as a new .txt file; nothing is
  overwritten. Your note doesn't change until you import."
- Footer hint: "Uses the network once: one download of this address."
- Primary **Download**. While running: "Downloading… 12 KB" with **Cancel** (aborts the request,
  nothing is saved). On error the message stays in the status line, primary becomes **Try again**.
- Help (?): `helpTexts.ts` `URL_IMPORT_HELP` (what is accepted, the network rule, VoiceDraft's
  address `http://<phone>:8787/current.md`, same Wi-Fi, where files go).

**After success** the saved path is written to `settings.import.filePath` (the Import screen reads
it from there) and the card switches to `view: 'import'`: the Import screen opens on the file with
its automatic preview. Its file row gets the line "downloaded hh:mm · from <host>" while that file
is the one just downloaded (state kept in the card, not stored). If the save fell back to EXPORT,
the status line says so (§4.4).

## 2. Layers and files

| Layer | File | Content |
|---|---|---|
| domain | `domain/urlImport.ts` (new) | `normalizeUrl`, `checkContentType`, `isTextBody`, `deriveFileName`, `safeFileName`, `parseContentDisposition` |
| domain | `domain/recentUrls.ts` (new) | `pushRecentUrl`, `removeRecentUrl`, `MAX_RECENT_URLS = 5` |
| domain | `domain/permissionResult.ts` (new, from Kept GTD) | `isPermissionGranted(result)`: only 1 and 2 grant; 0 and -1 (dialog closed) don't |
| domain | `domain/settingsModel.ts` | `urlImport: {recentUrls: string[], targetFolder: string}`, parsed field by field |
| domain | `domain/sourceRecord.ts` | `copyPath` reused unchanged |
| supernote | `supernote/httpFetch.ts` (new) | the plugin's **only** network code (§3) |
| supernote | `supernote/permissions.ts` | `ensureInternetPermission()`: session memory, `hasPermission` bounded 8 s, dialog 120 s, one request at a time; `ensurePermissions` switches to `isPermissionGranted` too (today a -1 counts as a grant) |
| supernote | `supernote/fileSelector.ts` | `chooseTargetFolder()` (§4.4) |
| storage | `storage/sourceFile.ts` | `writeTextFile` / `writeTextToExport` reused; `existsFile(path)` helper |
| actions | `actions/urlImport.ts` (new) | the flow (§4) |
| screens | `screens/import/UrlImportScreen.tsx`, `useUrlImport.ts` (new); `ManuscriptScreen.tsx` (`view: 'url'`), `FilesTab.tsx`, `ImportScreen.tsx` (downloaded line) | |

ESLint layer rules stay as they are: `httpFetch` imports nothing from `actions/` or `screens/`.

## 3. The fetch — `supernote/httpFetch.ts`

```ts
type FetchResult = {status: number; contentType: string | null; disposition: string | null; text: string; bytes: number};
fetchText(url: string, {timeoutMs = 15000, maxBytes = 2 * 1024 * 1024, signal}): Promise<FetchResult>
```

- `fetch(url, {method: 'GET', headers: {Accept: 'text/markdown, text/plain;q=0.9'}, signal})`;
  no cookies, no other headers, no body. `AbortController` for the timeout and for Cancel.
- Size: `Content-Length` > max → abort before reading. Otherwise the body is read as
  `arrayBuffer()` and checked; above the limit nothing is kept. (React Native's fetch has no
  streaming body; the timeout bounds an endless body.)
- Decode with `TextDecoder('utf-8', {fatal: true})` when available, else a small UTF-8 decoder in
  `domain/urlImport.ts` (`decodeUtf8`, tested) — a body that isn't valid UTF-8 is refused ("not
  UTF-8 text").
- Errors become typed results: `timeout`, `unreachable` (network error), `tooLarge`, `cancelled`,
  `http` (status + first line of the body, ≤ 120 chars, only when that body is text).
- One log line per download: host, status, bytes, ms. The URL path and the content are not logged.

AGENTS.md P0 "No network" becomes: *Network only in `supernote/httpFetch.ts`, called only from the
Download action. Flag any other `fetch`, `XMLHttpRequest`, `WebSocket` or network library.*

## 4. The flow — `actions/urlImport.ts`

`downloadToFile(rawUrl, targetFolder, signal) → {path, savedIn: 'target' | 'export', name}`

1. `normalizeUrl` — invalid → "Enter an address like http://192.168.1.42:8787/current.md".
2. `ensureInternetPermission()` — not granted → "Download needs internet access. Nothing was
   downloaded."
3. `fetchText`. Non-200 → `"<status> · <server's first line>"`; 404 from VoiceDraft thus shows
   "404 · No session is shared right now." Timeout → "No answer after 15 s. Is the phone on the same
   Wi-Fi?" Unreachable → "Couldn't reach <host>. Is the phone on the same Wi-Fi and VoiceDraft
   sharing?"
4. `checkContentType(contentType, text)` — refused → "This is <type>, not text or Markdown.
   Nothing was saved." (`text/html` gets "This is a web page, not a text file.")
5. Line ends: saved as received (VoiceDraft sends `\n`; the import handles both).
6. `deriveFileName(disposition, text, url)` (§4.3), then the target path; if it exists, `copyPath`.
7. Write (§4.4). Then `recentUrls` and `targetFolder` saved, `settings.import.filePath` set.

### 4.1 `normalizeUrl`

Trim; reject spaces inside; add `http://` without a scheme; only `http:`/`https:`; needs a host.
Returned unchanged otherwise (no lower-casing of the path). Tests: with/without scheme, IP + port,
https, `ftp:` refused, empty, spaces.

### 4.2 `checkContentType(type, body)`

Media type lower-cased, parameters dropped. Accepted list R4. Missing type → accepted when the body
decoded as UTF-8 and has no NUL. A `charset` other than utf-8/us-ascii → refused ("not UTF-8").

### 4.3 `deriveFileName`

Order: `filename*=UTF-8''…` (RFC 5987, percent-decoded) → `filename="…"` → frontmatter `title`
(quoted or plain YAML, unquoted and unescaped) → first `# ` heading → last URL path segment without
extension → `download`. Then `safeFileName`: remove control chars and `/ \ : * ? " < > |`, collapse
spaces, trim dots and spaces, cut to 60 characters (on a character, not a byte), keep Unicode letters
(the Supernote shows umlauts fine), extension always `.txt` (a given `.md` is replaced).
Tests per source and per unsafe case.

### 4.4 Target folder and writing

- Default `IMPORT_FOLDER` (INBOX), the last used folder afterwards.
- **Change ›**: `chooseTargetFolder()` tries the selector's folder mode (`selectType` for folders,
  device check D2). Fallback, as in Linked files: choose any file in the folder, its folder is used
  ("Choose any file in the folder you want").
- Writing: `writeTextFile(path, text)` (host copy, then direct, read-back check). If that throws:
  `writeTextToExport(name, text)` and the status says "INBOX isn't writable for plugins: saved in
  EXPORT/<name>". The Import screen opens on that file either way. Result recorded in
  `supernote-host-facts.md` §1 (device check D1).

## 5. Permission

`PluginConfig.json` `uses-permissions` adds `plugin.permission.INTERNET`. Start-up still asks only
FILE:READ/WRITE (`REQUIRED_PERMISSIONS` unchanged). `ensureInternetPermission` (port of Kept GTD's
`pluginPermissions.ts`): `granted` cached in the module for the session; a pending request is
shared, not repeated; `hasPermission` bounded by 8 s, `requestPermission` by 120 s (`withTimeout`);
reason text: "Manuscript downloads the one address you entered. Nothing from your device is sent."

## 6. Docs and texts in the same change

- DEVELOPMENT-POLICY §2 **Offline** → "**Network only on request.** The plugin uses the network only
  when you tap Download in Import from URL: one GET of the address you typed. It sends nothing from
  the device, keeps no connection open, runs nothing in the background, never polls."
- AGENTS.md P0 rule (§3 above). README (feature + permission line), PRIVACY.md (what is sent: an
  HTTP GET with the address; where the file goes), `design-overview.md` (the fetch's place),
  `supernote-host-facts.md` (§2 INTERNET permission, §1 INBOX writability, cleartext HTTP),
  `helpTexts.ts`, CHANGELOG `[Unreleased]`: "Import from URL: download a text or Markdown file
  (e.g. from VoiceDraft) and import it."

## 7. Steps (each: `npm run check` green, own commit with "Device test:")

1. **U1 domain:** `urlImport.ts`, `recentUrls.ts`, `permissionResult.ts`, settings field; tests.
2. **U2 fetch and permission:** `httpFetch.ts`, `ensureInternetPermission`, `ensurePermissions` on
   `isPermissionGranted`, PluginConfig, policy/AGENTS/README/PRIVACY.
3. **U3 flow and screens:** `actions/urlImport.ts`, `UrlImportScreen`, Files tab entry, card routing,
   Import screen line, help, CHANGELOG.
4. **U4 device:** D1–D4, host facts, "As built".

## 8. Device checks

- D1 Can a plugin write into INBOX (host copy / direct)? Else EXPORT fallback.
- D2 Does the file selector offer a folder mode? Which `selectType`?
- D3 INTERNET dialog: result codes for Allow, Deny, closed; does the grant survive a restart?
- D4 Cleartext HTTP to the phone and HTTPS to a public host both work from the plugin host.

## 9. Open points (not now)

- HTML → Markdown conversion (saved as .txt) for `text/html`.
- Reload: re-download into an already linked file through the Linked-files conflict check.

## 10. Notes for the VoiceDraft side

Its proposals fit. Two small additions help Manuscript: send `filename*=UTF-8''<percent-encoded>`
next to the ASCII `filename` so umlauts survive (Manuscript prefers it), and keep `\n` line ends.
An empty session (frontmatter + `# Title`) imports as a single heading — fine.

## As built

Commits on `feature/import-from-url` (each with `npm run check` green):

1. **Treat a closed permission dialog as not granted** - `domain/permissionResult.ts` and
   `ensurePermissions` taken over from Tilman's local fix (the answer -1 had counted as a grant).
2. **U1** `domain/urlImport.ts`, `domain/recentUrls.ts`, `settings.urlImport`; tests in
   `__tests__/domain/urlImport.test.ts`.
3. **U2** `supernote/httpFetch.ts`, `ensureInternetPermission`, INTERNET in `PluginConfig.json`,
   policy/AGENTS/PRIVACY/README/host facts.
4. **U3** `actions/urlImport.ts`, `screens/import/UrlImportScreen.tsx` + `useUrlImport.ts`, the
   Files tab entry, the card's `view: 'url'`, the Import screen's "Downloaded …" line,
   `URL_IMPORT_HELP`, CHANGELOG and README; UI tests `__tests__/ui/urlImport.test.tsx`,
   `filesTab.test.tsx`.

Differences from the design:

- **ESLint enforces the network rule:** `no-restricted-globals` refuses `fetch`, `XMLHttpRequest`,
  `WebSocket` and `EventSource` everywhere but `supernote/httpFetch.ts`.
- **Decoding** always uses the plugin's own strict `decodeUtf8` (no `TextDecoder` branch), so the
  device and Jest run the same code.
- **An HTTP error's text** is shown only when the server sent it as `text/plain` (VoiceDraft's 404
  line), never a web page's markup.
- **Copy names:** `copyCandidate` adds a counter ("… 1012 2).txt") when the dated copy name is
  taken too (two downloads of one name within a minute).
- **Folder choice (§4.4, D2 answered by the SDK):** `RattaFileSelector.selectFile` in
  sn-plugin-lib 0.2.3 documents file selection only (`selectType` 0 or 1), no folder mode. Change ›
  always picks a file (txt, note, pdf, epub, docx, png, jpg) and uses its folder.
- **The address field** starts with the newest recent address.
- **Not shown on a note bound to a folder** (its new files come from the folder).

Device checks D1, D3 and D4 are open until the device test of this branch; their results go into
`supernote-host-facts.md`.
