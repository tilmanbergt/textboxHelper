# Privacy and data

Manuscript (formerly Textbox Tools) is a local plugin for the Supernote. There is no
account, no server and no telemetry. It reads and writes files, and it uses the network for one
thing only: **Import from URL**, when you tap Download. Nothing it reads or writes leaves the
device.

## Network

`PluginConfig.json` asks for reading and writing files and for INTERNET. INTERNET is asked the
first time you tap Download in a session, never at start. A download is one HTTP or HTTPS GET of
the address you typed: the request carries the address and the usual HTTP headers (an `Accept`
header for text and Markdown), and nothing else - no note content, no file, no identifier, no
cookie. The answer is saved as a text file (below). Manuscript keeps no connection open, runs
nothing in the background and never checks an address by itself. The last five addresses you
used are kept in `settings.json`; you can remove them on the Import from URL screen.

## What it reads and writes

- **The open note.** It reads the textboxes and your pen strokes on the pages you work on (to
  read edit marks and tagged handwriting) and changes textboxes and pages only when you apply a
  change you saw first. It can add pages (text that grows, the "Set aside" divider) and NOTE
  titles for headings. Your handwriting is never changed, except when you choose to erase the
  handwriting of a change you drop.
- **The plugin's own folder** on the device (given by the Supernote, not one of your folders):
  - `settings.json` - your settings, with the last five addresses of Import from URL;
  - `pen-edits/` - for every piece of handwriting you tag with "Insertion or Replacement": its
    strokes, a picture of it and the recognized text, until the change is applied or dropped;
  - backups - a JSON copy of the textboxes of the pages a change touches, written before the
    change (their summary is also put on the clipboard);
  - `block-status.json` - the Outline's statuses (open, review, final);
  - `manuscript-cheatsheet.png` - the cheat sheet picture, written when you put it on a page;
  - `sources/` - for a note linked to a text file: which file and note belong together, and a copy
    of the file's text before the plugin first writes to it and before its latest write.
- **Text files you import or link**, wherever you choose them with the Supernote file selector
  (it opens in INBOX or the folder of your last file). A linked file is written back only when
  you apply changes or tap "Update", and never when it was changed outside the plugin since.
  "Check write access" writes and removes a small probe file (`.manuscript-probe.txt`) in that
  folder.
- **Folders you link**: the `.txt` files directly in them are listed.
- **Downloads** (Import from URL): each is saved as a new `.txt` file in the folder you chose
  (INBOX unless you change it), or in EXPORT when that folder can't be written. An existing file
  is never overwritten: the new one gets "(Supernote <date> <time>)" in its name.
- **EXPORT**: DOCX exports, the file of **Report a problem** when you write one (below), and
  the cheat sheet picture when it can't be put on the page.
- **`MyStyle/Manuscript/fonts`** (and `MyStyle/fonts`): only read, to measure text in fonts
  you copied there.

## Cleaning up

The plugin removes what it no longer needs: pen edits applied or dropped more than 3 days ago,
with their handwriting and picture; backups beyond the 3 newest of the last 14 days; the copies
of a file's text when you unlink it. Manuscript → Settings → Diagnostics → Storage shows how much
the plugin keeps and has **Clean up now**. Your notes, your text files and anything in EXPORT are
never removed by the clean-up.

## Report a problem

**Report a problem** (Manuscript → Settings → Diagnostics) writes one file to EXPORT,
`manuscript-report-<time>.json`, for a bug report. It contains the plugin version, the device model
and Android version, the open note's file name (no folders), page count and page size, the
settings, how the last marks were read (positions, decisions, the length of the text they touch),
the recorded timings and the errors and warnings of this session. Your text is in it only when
you tick **Include the text of this page**: then the textboxes of the current page and the text
previews of the marks are in it too.

The session's errors and warnings are kept in memory only (the newest 50) and are gone when the
plugin is closed. Messages also go to the Android system log (`logcat`) on the device. Nothing is
uploaded: you decide whether to attach the file to a bug report, and can look through it first.
