# Trellis Independence Roadmap

Trellis began as a rebrand of [Zotero](https://www.zotero.org) and is becoming a
fully independent, self-contained application. This document tracks the work to
cut every remaining dependency on Zotero's repositories and infrastructure.

> **License:** Zotero is licensed under the **AGPLv3**. Code derived from it —
> which is all of Trellis today — remains AGPLv3. Keep the source open and
> preserve upstream copyright/license notices. Decide this deliberately before
> distributing builds.

## Status legend
- [x] done
- [ ] not started
- [~] partial / in progress

## 1. Branding & identity
- [x] User-facing display name (brand files, installer, OS integration, locale)
- [x] Code namespace `Zotero` → `Trellis`, `chrome://zotero` → `chrome://trellis`
- [x] App ID, bundle ID, protocol scheme, pref branch (`extensions.trellis.`)
- [x] Single source of truth for brand display values (`branding/brand.config.json`
      + `js-build/generate-branding.mjs`)
- [x] Brand-consistency CI gate (`scripts/check-branding.mjs`, `.github/workflows/checks.yml`)
- [ ] Replace residual upstream org references with the real Trellis legal entity
      (currently placeholder "the Trellis project"; also `PRODUCER` /
      `PRODUCER_URL` in `resource/config.mjs`)
- [ ] Profile/data migration story for users moving from a `zotero` data dir /
      `extensions.zotero.*` prefs (so adopting Trellis doesn't silently reset state)

## 2. De-submodule: vendor code in-tree
The repo currently pulls 13 git submodules. Independence means committing their
(rebranded) code directly and removing the external pointers from `.gitmodules`.

Code modules (straightforward to vendor):
- [ ] `reader` (PDF/EPUB/snapshot rendering)
- [ ] `note-editor`
- [ ] `document-worker` (PDF processing)
- [ ] `chrome/content/trellis/xpcom/utilities`
- [ ] `chrome/content/trellis/xpcom/translate` (translation framework)
- [ ] `resource/SingleFile` (page archiving)
- [ ] `resource/schema/global` (item-type schema)

Word-processor integration (vendor + rebrand):
- [ ] `app/modules/trellis-word-for-mac-integration`
- [ ] `app/modules/trellis-word-for-windows-integration`
- [ ] `app/modules/trellis-libreoffice-integration`

Keep as external dev/test deps (genuinely third-party, not Zotero):
- `test/resource/chai`, `test/resource/mocha`

> Note: submodules currently point at `github.com/trellis/*` repos that do not
> exist yet. Bootstrapping starts from the upstream Zotero submodule content
> (AGPL) before internalizing.

## 3. Data ecosystems (strategic decision)
- [ ] **Translators** (760+ web scrapers): vendor a snapshot and maintain our own
      pipeline, or keep consuming upstream. Zotero-specific ecosystem — the
      stickiest dependency.
- [ ] **CSL styles** (`styles`) and **CSL locales** (`chrome/content/trellis/locale/csl`):
      these are the *citation-style-language* open standard, **not** Zotero. Safe to
      keep consuming upstream.

## 4. Backend services (largest effort — needs hosting)
All currently on `*.zotero.org`, repointed to non-existent `*.trellis.org`:
- [ ] Data/library sync API (`api.trellis.org`)
- [ ] File storage / "Trellis Storage" (`zfs`)
- [ ] Auto-update server (`AppUpdate` URL in `application.ini`)
- [ ] Translator/style update repo (`repo.trellis.org`)
- [ ] Metadata recognizer & identifier lookup (`services.trellis.org`)
- [ ] Streaming (`stream.trellis.org`)
- [ ] CI build artifact bucket (`trellis-download` S3 in `ci.yml`)

Until these exist, the corresponding features are non-functional. The storage
layer has a clean controller interface (`chrome/content/trellis/xpcom/storage/`,
selected in `storageLocal.js`) — new backends are the most tractable extension
point.

## 5. Interop strings to revisit
The rebrand renamed identifiers that cross into external components. Decide
per-item whether to keep `trellis` (and own the consequence) or restore for
compatibility:
- [ ] Browser-connector header `X-Trellis-Connector-API-Version` (vs the external
      Zotero Connector)
- [ ] RDF export namespace `trellis.org/namespaces/export#` (vs Zotero RDF interop)
- [ ] Word-processor field codes (existing-document compatibility)

## 6. CI / quality
- [x] Fast branding + consistency gate that runs without submodules (`checks.yml`)
- [ ] Get the full build+test pipeline (`ci.yml`) green once submodules are vendored
      and xulrunner fetch is independent
- [ ] Enable GitHub Actions on the repository (forks have it disabled by default)

## Recommended order
1. Branding consistency + CI gate (done — this PR).
2. Vendor the code submodules (§2) so the repo builds standalone.
3. Get `ci.yml` green (§6).
4. Decide translators strategy (§3).
5. Stand up backend services incrementally (§4), starting with storage backends.
