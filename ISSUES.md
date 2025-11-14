# ISSUES that needs to be adressed and solved

## 1. Deprecated Popup API Usage

**Issue**: `view.popup.close()` is deprecated as of ArcGIS JS API 4.27. The popup is no longer created by default, causing the close method to fail.

**Solution**: Replace all instances of `view.popup.close()` with `view.closePopup()`.

**Files to update**:

- Search codebase for `view.popup.close()` and replace with `view.closePopup()`
- Verify popup suppression manager uses the updated API

## 2. Geometry Operators Module Incompatibility

**Issue**: `esri/geometry/operators.js` is causing 404 errors and MIME type execution failures. This module is incompatible with the current ArcGIS JS API configuration.

**Solution**: Remove all references to `esri/geometry/operators` from the codebase. Use native ArcGIS JS API geometry modules instead (e.g., `esri/geometry/geometryEngine`, `esri/geometry/projection`).

**Files to update**:

- Search for imports/requires of `esri/geometry/operators`
- Replace with appropriate `geometryEngine` or `projection` module methods
- Verify all geometry operations use the correct ArcGIS JS API 4.29 modules
