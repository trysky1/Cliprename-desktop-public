# ClipRename Desktop — Project Guide

ClipRename is an Electron desktop companion to cliprename.com. It points at local
editing folders, sorts audio/video/images, AI-renames them, and stages clips that
drag straight into an NLE (Premiere / After Effects / DaVinci).

## Tech Stack & Conventions

This project uses TypeScript as the primary language. Always type all functions,
props, and API responses; prefer strict mode and avoid `any`.

Stack: Electron 33 + electron-vite + Vite 5 + React 18 + TypeScript + Tailwind CSS 3.
ESM (`"type": "module"`); preload is emitted as `index.mjs`. AI is Google Gemini Flash
via REST. Media work uses ffmpeg-static + fluent-ffmpeg. Settings via electron-store;
packaging via electron-builder (NSIS).

## Authentication / Integrations

When implementing OAuth or third-party auth, first verify the platform's managed auth
model (e.g., Lovable Cloud's proxy) before building a custom PKCE flow, and confirm
provider credentials are configured before declaring login complete.

## Definition of Done / Verification

Validate that delivered apps actually run end-to-end (build, install, and core
happy-path) before reporting success; explicitly flag any unverified parts like
external services.
