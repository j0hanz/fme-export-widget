# Code Smell Assessment

This document captures notable code smells discovered while reviewing the repository. The intent is to highlight maintainability and design risks rather than provide exhaustive coverage.

## 1. Monolithic runtime widget component

The runtime widget is implemented in a single `widget.tsx` file that spans roughly 1,900 lines and mixes disparate responsibilities: ArcGIS map resource management, Redux error handling, SketchViewModel wiring, and submission/network orchestration. For example, the same module defines low-level map setup helpers (`createSketchVM`, `setupSketchEventHandlers`) alongside network submission logic in `handleFormSubmit`.【F:src/runtime/widget.tsx†L466-L620】【F:src/runtime/widget.tsx†L1289-L1402】

Having so many concerns bundled together makes the component difficult to navigate, reason about, and test. Breaking the widget into smaller modules—e.g., separate hooks for map lifecycle management, submission pipelines, and UI state—would improve cohesion and reduce the cognitive load for future changes.

## 2. Re-instantiating the API client for every submission *(mitigated)*

`handleFormSubmit` previously constructed a brand new `FmeFlowApiClient` via `createFmeFlowClient` each time the user submitted the form. Every client constructor immediately queued setup work that adjusted global ArcGIS request settings and installed a host-specific interceptor.【F:src/runtime/widget.tsx†L1299-L1380】【F:src/shared/api.ts†L536-L557】

Because submissions can happen frequently, this pattern repeatedly triggered global configuration updates (`setApiSettings`) and interceptor registration (`addFmeInterceptor`). Aside from the extra async churn, it increased the risk of race conditions when multiple submissions overlapped. The widget now caches a single client per configuration and disposes it when settings change or the widget unmounts, eliminating redundant setup work while still refreshing credentials when necessary.【F:src/runtime/widget.tsx†L681-L755】【F:src/runtime/widget.tsx†L1304-L1313】

## 3. Global interceptor/token cache never released *(mitigated)*

The shared API module stores FME tokens per host in a module-level `_fmeTokensByHost` map and pushes interceptors into the ArcGIS request configuration when a client is created.【F:src/shared/api.ts†L49-L115】【F:src/shared/api.ts†L326-L415】 The cache was only pruned when `addFmeInterceptor` was invoked with an empty token, but the runtime never called such a teardown path when widgets unmounted.

Tokens and interceptors therefore lingered in process-wide state even after a widget was disposed or a session ended, which is problematic for long-lived applications and multi-user environments. The API client now exposes a `dispose` method that removes interceptors, aborts outstanding requests, and prevents further use. Widget code calls this hook when instances are replaced or destroyed so global state is reclaimed promptly.【F:src/shared/api.ts†L526-L575】【F:src/shared/api.ts†L1388-L1396】【F:src/runtime/widget.tsx†L699-L755】【F:src/runtime/components/workflow.tsx†L1005-L1033】
