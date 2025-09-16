# FME Export widget (ArcGIS Experience Builder 1.18)

Export a user‑drawn Area of Interest (AOI) from an Experience Builder map to FME Flow (Server). The widget guides the user through drawing a polygon/rectangle, selecting an FME workspace, filling in parameters, and submitting an export job.

📦 **[Download Widget](https://github.com/user-attachments/files/22362200/fme-export.zip)** _(Updated: September 16, 2025)_

## What it does

- Draw AOI on the map using Sketch (Polygon or Rectangle; polygons are submitted)
- Computes planar area and displays it (Swedish locale; m²/km²)
- Lists FME workspaces from a configured repository and loads their published parameters
- Renders a dynamic form from workspace parameters (choices, numbers, text, booleans, files, etc.)
- Submits an export job to FME Flow using the Data Download webhook
- Shows a confirmation with Job ID, email, and optional download URL

Core flow: INITIAL → DRAWING → WORKSPACE_SELECTION → EXPORT_FORM → ORDER_RESULT.

## Installation (Experience Builder Dev Edition)

1. Install EXB 1.18 Developer Edition
   - Download: <https://developers.arcgis.com/experience-builder/guide/downloads/>
   - Install guide: <https://developers.arcgis.com/experience-builder/guide/install-guide/>
   - Create a Client ID as per the install guide.

2. Start EXB services
   - In `server/`: `npm ci`, then `npm start`
   - In `client/`: `npm ci`, then `npm start`
   - Open <https://localhost:3001/>

3. Install the widget
   - Copy this folder `fme-export` into `client/your-extensions/widgets/`
   - Run the extension bootstrap so EXB discovers it:
     - From `client/`: `node .\npm-bootstrap-extensions`
   - Restart the client build if needed

4. Add to an app
   - In the Builder UI, drag “FME Export” onto your app
   - Ensure the widget is connected to exactly one Map widget

## Configuration (Builder settings)

The widget reads these config values (keys shown for reference):

```jsonc
{
  // Required
  "fmeServerUrl": "https://your-host[/fmeserver]", // trailing /fmeserver or /fmerest ok (normalized)
  "fmeServerToken": "<FME Flow token>", // used as fmetoken Authorization header
  "repository": "<FME Repository>", // repository to list workspaces from

  // Optional
  "maxArea": 25000000, // m² limit for AOI validation (reject if exceeded)
  "requestTimeout": 30000, // ms request timeout for FME calls
  "geometryServiceUrl": "...", // reserved for future use
  "api": "...", // reserved for future/advanced use
}
```

Notes:

- The code normalizes the server URL by stripping trailing `/fmeserver` or `/fmerest` automatically.
- The token is attached as `Authorization: fmetoken token=<TOKEN>` for webhook and REST calls.
- The repository is used to fetch workspaces and their parameters.

## How it works (FME integration)

- Primary submission path: Webhook GET to `/fmedatadownload/{repository}/{workspace}` with query:
  - `opt_responseformat=json`, `opt_showresult=true`, `opt_servicemode=async`, plus your published parameters
  - AOI is attached as `AreaOfInterest` containing polygon Esri JSON (stringified)
  - Requester email is included as `opt_requesteremail` (pulled from Portal user, with a no‑reply fallback)

  Note: The widget expects the Data Download webhook to return JSON; HTML or non-JSON responses are surfaced as authentication errors to the user.

- Trusted server + token: All REST calls go through Esri’s `esri/request` with an interceptor that adds the FME token and trusts the server origin.

Geometry submitted

- Only polygon AOI is submitted to FME. Rectangles drawn are converted to polygons by Sketch.
- Extent and area metrics are also computed client‑side for validation and optional downstream use.

## Using the widget

1. Choose drawing mode (Polygon or Rectangle) from the tabs; drawing starts immediately
2. Draw the AOI on the map. After the first click/drag, tabs hide and instruction text guides you
3. When finished, the widget validates the geometry and proceeds to workspace selection
4. Select an FME workspace from the repository list and fill in parameters
5. Submit. You’ll see job confirmation with ID and optional download URL

## Developer guide

Key files

- `src/runtime/widget.tsx` – main orchestrator and map integration (Sketch, layers, measurements)
- `src/runtime/components/workflow.tsx` – views for drawing, selection, form, result
- `src/runtime/components/ui.tsx` – small UI toolkit built on `jimu-ui`
- `src/shared/types.ts` – complete domain model and Redux action/state types
- `src/shared/api.ts` – `FmeFlowApiClient` (webhook-based) and helpers
- `src/shared/services.ts` – form generation and validation from workspace parameters
- `src/extensions/store.ts` – Redux store extension (`storeKey: "fme-state"`)

Golden rules implemented

- Functional React only; no `any`; immutable Redux updates via `fmeActions`
- Never import `@arcgis/core`; modules are loaded with `loadArcGISJSAPIModules([...])`
- ArcGIS objects (views, layers, Sketch, geometry) are kept in local state; Redux stores only serializable JSON (`geometryJson`)
- AOI submitted as polygon Esri JSON under the parameter `AreaOfInterest`
- All FME calls go through `createFmeFlowClient(config)`

Build, test, lint (from `client/`)

```powershell
# Start dev build (watch)
npm start

# TypeScript check (widget only)
npm run type-check

# Lint / fix (widget only)
npm run lint
npm run lint:fix

# Run tests (Jest with EXB mocks)
npm test

# Build bundles
npm run build:dev
npm run build:prod
npm run build:for-download

# IMPORTANT after adding/renaming extensions
node .\npm-bootstrap-extensions
```

## Troubleshooting

- Webhook returns HTML or 401/403
  - This usually indicates the webhook requires authentication; ensure the configured token and URL are correct.
- No workspaces listed
  - Verify `repository` exists and token has rights; check CORS/trusted server if calls fail.
- “Area too large” / validation error
  - Decrease AOI size or increase `maxArea` in settings.
- Token/URL issues
  - Server URL can include or omit trailing `/fmeserver`/`/fmerest`; both are normalized. Ensure valid FME token.

## Security

- Treat your FME token as a secret. Don’t commit real tokens to version control. The example `config.json` is for local dev only.

## Requirements

- ArcGIS Experience Builder Developer Edition 1.18+
- Node.js (see EXB’s recommended version)
- FME Flow (Server) with REST API enabled

## Links

- Experience Builder: downloads and install guide
  - <https://developers.arcgis.com/experience-builder/guide/downloads/>
  - <https://developers.arcgis.com/experience-builder/guide/install-guide/>
- Widget development overview: <https://developers.arcgis.com/experience-builder/guide/getting-started-widget/>
- FME Flow REST API: <https://docs.safe.com/fme/html/FME_Server_REST_API/>
