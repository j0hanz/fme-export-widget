
# FME Export Widget for ArcGIS Experience Builder

This widget lets you export map features and geometries from ArcGIS Experience Builder to FME Flow (Server).

## What does it do?

- Lets users select/draw features on the map
- Submits selected geometry to FME Flow for export or transformation
- Handles job submission, status, and error reporting

---

## How to Install ArcGIS Experience Builder (Developer Edition)

1. **Download Experience Builder 1.18:**
   - [EXB 1.18 Download Page](https://developers.arcgis.com/experience-builder/guide/downloads/)

2. **Follow the official install guide:**
   - [EXB Install Guide](https://developers.arcgis.com/experience-builder/guide/install-guide/)

3. **Create a Client ID** (required for authentication):
   - See [Create a Client ID](https://developers.arcgis.com/experience-builder/guide/install-guide/#1-create-a-client-id)

4. **Install server and client services:**
   - Unzip EXB, open terminal, run `npm ci` then `npm start` in both `/server` and `/client` folders
   - Open [https://localhost:3001/](https://localhost:3001/) in your browser

---

## How to Install and Use the FME Export Widget

1. **Copy the widget folder:**
   - Place the `fme-export-widget` folder inside `client/your-extensions/widgets/` in your EXB install

2. **Restart the EXB client service:**
   - Stop and start the client service (`npm start` in `/client`) to detect new widgets

3. **Add the widget in Experience Builder:**
   - Open the builder interface, find the FME Export Widget in the widget list, and drag it onto your app

4. **Configure the widget:**
   - Enter your FME Flow server URL and token in the widget settings
   - Select map and geometry options as needed

---

## Requirements

- ArcGIS Experience Builder Developer Edition 1.18+
- Node.js (see [recommended version](https://developers.arcgis.com/experience-builder/guide/release-versions/))
- FME Flow (Server) with REST API enabled

---

## Helpful Links

- [EXB Download](https://developers.arcgis.com/experience-builder/guide/downloads/)
- [EXB Install Guide](https://developers.arcgis.com/experience-builder/guide/install-guide/)
- [Widget Development Guide](https://developers.arcgis.com/experience-builder/guide/getting-started-widget/)
- [FME Flow REST API Docs](https://docs.safe.com/fme/html/FME_Server_REST_API/)

---

## Quick Start

1. Install Experience Builder and start server/client
2. Place this widget in `client/your-extensions/widgets/`
3. Restart the client service
4. Add and configure the widget in your app
5. Export features to FME Flow!
