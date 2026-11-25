# Privacy and data

Manuscript (formerly Textbox Tools) is a local plugin for the Supernote. There is no
account, no server and no telemetry, and it has **no network permission**: `PluginConfig.json`
asks only for reading and writing files. Nothing it reads or writes leaves the device.

## What it reads and writes

- **The open note.** It reads the textboxes and your pen strokes on the pages you work on (to
  read edit marks and tagged handwriting) and changes textboxes and pages only when you apply a
  change you saw first. It can add pages (text that grows, the "Set aside" divider) and NOTE
  titles for headings. Your handwriting is never changed, except when you choose to erase the
  handwriting of a change you drop.
- **The plugin's own folder** on the device (given by the Supernote, not one of your folders):
  - `settings.json` - your settings;
  - `pen-edits/` - for every piece of handwriting you tag with "Insertion or Replacement": its
    strokes, a picture of it and the recognized text, until the change is applied or dropped;
  - backups - a JSON copy of the textboxes of the pages a change touches, written before the
    change (their summary is also put on the clipboard);
  - `block-status.json` - the Outline's statuses (open, review, final);
  - `sources/` - for a note linked to a text file: which file and note belong together, and a copy
    of the file's text before the plugin first writes to it and before its latest write.
- **Text files you import or link**, wherever you choose them with the Supernote file selector
  (it opens in INBOX or the folder of your last file). A linked file is written back only when
  you apply changes or tap "Update", and never when it was changed outside the plugin since.
  "Check write access" writes and removes a small probe file (`.manuscript-probe.txt`) in that
  folder.
- **Folders you link**: the `.txt` files directly in them are listed.
- **EXPORT**: DOCX exports, and diagnostics or timings files when you save them (Manuscript →
  Settings → Diagnostics).
- **`MyStyle/Manuscript/fonts`** (and `MyStyle/fonts`): only read, to measure text in fonts
  you copied there.

## Cleaning up

The plugin removes what it no longer needs: pen edits applied or dropped more than 3 days ago,
with their handwriting and picture; backups beyond the 3 newest of the last 14 days; the copies
of a file's text when you unlink it. Manuscript → Settings → Diagnostics → Storage shows how much
the plugin keeps and has **Clean up now**. Your notes, your text files and anything in EXPORT are
never removed by the clean-up.

## Diagnostics files

Diagnostics and timings files in EXPORT contain the plugin version, settings, the positions of
the marks it read and how long steps took. Diagnostics of a marker preview contain short previews
of the words a mark touches. Please look through a file before attaching it to a bug report.

Messages go to the Android system log (`logcat`) on the device; nothing is uploaded.
