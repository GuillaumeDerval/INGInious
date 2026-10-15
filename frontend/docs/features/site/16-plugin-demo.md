# Plugin "demo": minimal page example

- **ID**: SITE-16
- **Actors**: anonymous / anyone
- **Routes**: GET /plugindemo
- **Depends on**: SITE-12
- **Legacy code**: `plugins/demo/__init__.py:L1-20`

## Use case
Developer example showing how a plugin adds a page (`plugin_manager.add_page`).

## Main flow
1. `GET /plugindemo` → HTTP 200, `Content-Type: text/html; charset=utf-8`, body exactly
   `This is a simple demo plugin` (plain string, no layout) — verified.

## Alternative / error flows
- POST → 405.
- Plugin disabled → 404.

## Data
None.

## Permissions & security
Public (no authentication), only while the plugin is enabled.

## Acceptance tests
- GET returns 200 and the exact text; no login required (enabled in the reference config).
