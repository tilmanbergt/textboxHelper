# Security policy

Manuscript (formerly Textbox Tools) is a plugin for the Supernote, made by one person in their
spare time. This page says which versions get security fixes, how to report a vulnerability
privately, and what the plugin touches.

## Supported versions

Security fixes go into the **latest release** on
[GitHub Releases](https://github.com/tilmanbergt/manuscript/releases), and into a beta while it is
the current one. Older versions get no fixes: update to the latest release.

## Reporting a vulnerability

Please report it **privately**, not in a public issue:

1. Open the repository's **Security** tab and choose **Report a vulnerability** (GitHub's private
   vulnerability reporting).
2. Describe what you found:
   - the plugin version (Supernote Settings → Apps → Plugins) and the Supernote model and firmware;
   - what an attacker could do, and what they need for it (for example a file on the device);
   - the steps to reproduce it, as short as you can make them.

Don't attach notes, text files or diagnostics files with real content. If one is needed, you'll
be asked for it, and you can replace the text first.

## What happens next

- You get an answer within a week. This is a best effort: it's a one-person project.
- If the report is confirmed, the fix comes in a patch release, and the release notes say what was
  fixed once it is out.
- You're credited in the release notes if you want to be.

## What the plugin touches

The details are in [PRIVACY.md](PRIVACY.md). In short:

- **The open note**: textboxes, pages and NOTE titles, changed only after a preview, with a backup
  written first.
- **Your files**: text files you import or link (written back only when you apply changes), the
  `.txt` files of folders you link, `EXPORT` for exports and diagnostics, fonts in `MyStyle` (read
  only).
- **The plugin's private folder** on the device: settings, tagged handwriting, backups, statuses
  and the records of linked files.

There is no network permission, no account, no server and no telemetry.
