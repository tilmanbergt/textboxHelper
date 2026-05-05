# Architecture Overview

This project is intentionally organized around the Supernote plugin workflow rather than around a generic editor architecture.

## High-Level Flow

1. Supernote button press enters through [index.js](index.js).
2. [src/pluginRouting.ts](src\pluginRouting.ts) captures the button event and forwards it into React Native.
3. [App.tsx](App.tsx) decides which review mode to open.
4. Feature modules build previews and apply plans:
   - [src/textboxActions.ts](src\textboxActions.ts)
   - [src/editMarkerActions.ts](src\editMarkerActions.ts)

## Main Modules

### `index.js`

Owns plugin registration:

- lasso toolbar buttons
- note toolbar buttons
- plugin startup

If a button does not appear where expected, start here first.

### `App.tsx`

Owns review UI:

- textbox tool preview and apply
- edit marker review and apply
- temporary calibration controls
- success and error messaging

This file should stay focused on presentation and user flow rather than low-level geometry.

### `src/textboxActions.ts`

Owns direct textbox editing operations:

- split
- join
- clean spaces
- remove line breaks

It should call shared sizing helpers instead of maintaining its own independent textbox height logic.

### `src/editMarkerActions.ts`

Owns handwritten and straight-line marker behavior:

- delete marker recognition
- replace marker recognition
- replacement source resolution
- preview generation
- apply plan generation

This file is the main orchestration layer for marker features.

## Shared Supernote Textbox Core

The shared files under [src/shared](src\shared) are designed to be reusable across sibling Supernote plugins.

### `supernoteTextboxGeometry.ts`

Owns:

- rectangle math
- overlap helpers
- point-in-rect helpers
- reading-order sorting

### `supernoteTextboxLayout.ts`

Owns:

- textbox measurement width policy
- native measurement bridge wrappers
- fallback sizing
- final textbox resize calculation

This is the single source of truth for textbox height estimation.

### `supernoteTextboxHitTesting.ts`

Owns:

- page-space word boxes derived from measured text
- line-band filtering
- word lookup by page coordinate
- approximate character lookup

This is where coordinate-to-text mapping should live.

## Android Native Measurement Bridge

[TextboxMetricsModule.kt](android\app\src\main\java\com\textboxhelper\TextboxMetricsModule.kt) exposes Android `StaticLayout` measurements to JavaScript.

It is used because textbox height, wrapping, and hit testing are much more reliable when measured with native Android text layout than with a plugin-side approximation alone.

## Design Intent

The current architecture tries to keep these responsibilities separate:

- UI flow in `App.tsx`
- feature orchestration in `textboxActions.ts` and `editMarkerActions.ts`
- reusable geometry and measurement in `src/shared`
- platform-specific text measurement in the Android native module

When adding new features, prefer reusing the shared textbox core before adding new local helpers in feature files.
