# FME Export Widget

![Version](https://img.shields.io/github/v/release/j0hanz/fme-export-widget?label=Version)![Uppdaterad](https://img.shields.io/github/last-commit/j0hanz/fme-export-widget?label=Updated)![Kodstorlek](https://img.shields.io/github/languages/code-size/j0hanz/fme-export-widget?label=Size)![FME Flow API v4](https://img.shields.io/badge/FME%20Flow%20API-V4-orange.svg?label=FME-Flow)

![React 18.3.1](https://img.shields.io/badge/React-18.3.1-61DAFB.png?logo=react&logoColor=000000&style=flat)![Experience Builder](https://img.shields.io/badge/ArcGIS-Experience%20Builder-2C7CBE.png?logo=arcgis&logoColor=ffffff&style=flat)![ArcGIS JS API](https://img.shields.io/badge/ArcGIS%20JS%20API-4.29-0176D2.png?logo=arcgis&logoColor=ffffff&style=flat)![TanStack Query](https://img.shields.io/badge/TanStack%20Query-v5-FF4154.png?logo=reactquery&logoColor=ffffff&style=flat)

![Stjärnor](https://img.shields.io/github/stars/j0hanz/fme-export-widget)![Forks](https://img.shields.io/github/forks/j0hanz/fme-export-widget)![Issues](https://img.shields.io/github/issues/j0hanz/fme-export-widget)![Pull requests](https://img.shields.io/github/issues-pr/j0hanz/fme-export-widget)![Bidragsgivare](https://img.shields.io/github/contributors/j0hanz/fme-export-widget?color=2b9348)

---

Widgeten integrerar FME Flow i ArcGIS Experience Builder med ett färdigt användargränssnitt. Användare ritar ett område (AOI – Area of Interest) på kartan, fyller i dynamiskt genererade formulär och får data levererade via direktnedladdning eller e-post – utan att behöva FME-kunskaper.

**Syfte:** Erbjuda ett komplett FME‑exportgränssnitt som enkelt införs i organisationer som använder både ArcGIS och FME.  
**Målgrupp:** Organisationer som vill erbjuda webbaserad FME Flow-export utan egen utveckling.

---

## Innehåll

Den här README:n innehåller följande avsnitt för att hjälpa dig navigera och
hitta rätt information:

1. [Snabböversikt](#snabböversikt)
1. [Snabbstart](#snabbstart)
1. [Distribution](#distribution)
1. [Funktioner](#funktioner)
1. [Installation](#installation)
   1. [Systemkrav](#systemkrav)
   1. [Installationssteg](#installationssteg)
1. [Användning](#användning)
1. [Konfiguration](#konfiguration)
1. [Arkitektur](#arkitektur)
1. [Kom igång med din egen widget](#kom-igång-med-din-egen-widget)
1. [Felkoder](#felkoder)
1. [Utveckling](#utveckling)
1. [Vanliga frågor (FAQ)](#vanliga-frågor-faq)
1. [Support och resurser](#support-och-resurser)

---

## Snabböversikt

| Komponent          | Version / Krav          |
| ------------------ | ----------------------- |
| Experience Builder | Developer Edition 1.18+ |
| ArcGIS JS API      | 4.29                    |
| React              | 18.3.1                  |
| TanStack Query     | v5.90                   |
| FME Flow API       | v4                      |
| Webbkarta          | Krävs för AOI‑ritning   |

---

## Snabbstart

1. **Forka & klona** – skapa en egen fork och kör `git clone <din fork>`.
2. **Installera** – flytta widgetmappen till `client/your-extensions/widgets/`, kör `npm ci` i `client/` och installera `@tanstack/react-query`.
3. **Starta utveckling** – kör `npm start` för Experience Builder och (valfritt) `npm start` i `server/` för mockad backend.
4. **Konfigurera** – lägg till widgeten i layouten, koppla en webbkarta, fyll i FME‑inställningar och klicka **Testa anslutning**.

---

## Distribution

Välj version utifrån din FME Flow‑miljö:

| Version | Målmiljö    | Nedladdning                                                                                      | Status        |
| ------- | ----------- | ------------------------------------------------------------------------------------------------ | ------------- |
| v1.1    | FME Flow v4 | [Ladda ned](https://github.com/j0hanz/fme-export-widget/releases/download/v1.1/fme-export.zip)   | Rekommenderad |
| v1.0‑V3 | FME Flow v3 | [Ladda ned](https://github.com/j0hanz/fme-export-widget/releases/download/1.0-V3/fme-export.zip) | Legacy        |

---

## Funktioner

Widgeten erbjuder följande funktioner:

| Funktion               | Beskrivning                                              |
| ---------------------- | -------------------------------------------------------- |
| **AOI‑ritning**        | Rita polygoner/rektanglar med automatisk ytkontroll      |
| **Dynamiska formulär** | Genereras från workspace‑parametrar                      |
| **Flexibel körning**   | Välj sync (direkt nedladdning) eller async (e‑post)      |
| **Säker hantering**    | Token‑autentisering, HTTPS‑validering, maskerad loggning |
| **Användarvänligt UI** | Tydligt flöde med realtidsvalidering                     |

---

## Installation

### Systemkrav

För att använda widgeten behöver du följande:

- **Experience Builder:** Developer Edition 1.18 eller senare
- **ArcGIS Maps SDK for JavaScript:** 4.29 eller senare
- **FME Flow:** Server med REST‑API v4 aktiverat
- **Webbkarta:** krävs i Experience Builder‑appen för att kunna rita område
- **React Query:** `@tanstack/react-query` (installeras via npm)

### Installationssteg

Följ dessa steg för att installera widgeten i din egen Experience Builder‑app. Exemplen använder `git` och `npm`.

1. **Hämta källkoden** – forka repositoryt och klona din fork:

   ```bash
   git clone https://github.com/DITT-ANVÄNDARNAMN/fme-export-widget.git
   ```

2. **Installera widgeten** – kopiera mappen till `client/your-extensions/widgets/` och installera paket:

   ```bash
   cd client
   npm ci
   npm install @tanstack/react-query
   ```

3. **Bygg widgeten** – skapa utvecklings- eller produktionsbygge:

   ```bash
   # Utvecklingsserver med hot‑reload
   npm start

   # Produktionsbygge
   npm run build:prod
   ```

4. **Konfigurera i Experience Builder** – lägg till widgeten i layouten, välj en webbkarta, ange FME‑inställningar och tryck **Testa anslutning**.

### Vanliga installationsfrågor

- **Varför två npm-installationer?** `client/` innehåller Experience Builders beroenden medan `server/` bara krävs om du kör den mockade testservern.
- **Måste jag använda `npm ci`?** Rekommenderas för reproducerbara byggen, men `npm install` fungerar om du behöver uppdatera beroenden.
- **Hur verifierar jag innan publicering?** Kör `npm run build:dev` för att säkerställa att bundlingen lyckas och att importerna är korrekt konfigurerade.

> **Tips:** Du kan även installera widgeten direkt i ArcGIS Enterprise/Online via manifestet `https://j0hanz.github.io/fme-export-widget/manifest.json`.

---

## Användning

Det rekommenderas att placera widgeten i en **Widget Controller** för att isolera
kartresurser. Utan controller kan andra widgets störa ritflödet.

### Arbetsflöde

1. **Rita område** – markera ditt intresseområde på kartan.
2. **Välj workspace** – välj vilken FME‑process som ska köras.
3. **Ange parametrar** – fyll i det genererade formuläret.
4. **Välj leverans** – välj sync (nedladdning) eller async (e‑post/webhook).
5. **Skicka** – starta exporten och följ status.

---

## Konfiguration

Widgeten har många konfigurerbara inställningar. Nedan presenteras de viktigaste
delarna. Fyll i dessa i Experience Builders administrationsgränssnitt.

### FME Flow Server

| Inställning    | Beskrivning                                                           |
| -------------- | --------------------------------------------------------------------- |
| **Server‑URL** | Adress till FME Flow, till exempel `https://fmeflow.exempel.se`       |
| **API‑token**  | Token från FME Flow med behörighet att läsa repositoryn och köra jobb |
| **Repository** | Namnet på det repository där publicerade workspaces finns             |

### Geometri och validering

| Inställning                    | Beskrivning                                                         | Standard         |
| ------------------------------ | ------------------------------------------------------------------- | ---------------- |
| **Parameternamn för område**   | Namnet på den publicerade parametern som tar emot områdets geometri | `AreaOfInterest` |
| **Maximal exportyta (m²)**     | Högsta tillåtna yta. Överskrids gränsen stoppas exporten            | Obegränsad       |
| **Varningsgräns för yta (m²)** | Visar varning vid stora områden som kan ge långa bearbetningstider  | Ingen varning    |

### Jobbhantering

| Inställning               | Beskrivning                                                             | Standard          |
| ------------------------- | ----------------------------------------------------------------------- | ----------------- |
| **Maximal körtid (s)**    | Max körtid innan FME Flow avbryter jobbet (gäller endast synkrona jobb) | Serverns standard |
| **Timeout för förfrågan** | Maximal väntetid på svar från FME Flow                                  | Obegränsad        |

### Filhantering

| Inställning                  | Beskrivning                                                                    | Standard       |
| ---------------------------- | ------------------------------------------------------------------------------ | -------------- |
| **Tillåt filuppladdning**    | Gör det möjligt att ladda upp filer som indata till workspace                  | Inaktiverad    |
| **Tillåt fjärr‑URL (HTTPS)** | Användaren kan ange en HTTPS‑URL som datakälla                                 | Inaktiverad    |
| **Uppladdningsparameter**    | Namn på den publicerade parametern som tar emot sökvägen till en uppladdad fil | `DEST_DATASET` |

### Säkerhet och meddelanden

| Inställning              | Beskrivning                                                           | Standard    |
| ------------------------ | --------------------------------------------------------------------- | ----------- |
| **Kräv HTTPS**           | Tvingar all kommunikation med FME Flow att använda HTTPS              | Inaktiverad |
| **Maskera e‑postadress** | Döljer delar av användarens e‑postadress i bekräftelsevyn             | Inaktiverad |
| **Supportkontakt**       | E‑postadress eller länk som visas i felmeddelanden                    | Tom         |
| **Aktivera loggning**    | Visar detaljerad loggning i webbläsarkonsolen (endast för utveckling) | Inaktiverad |

---

## Arkitektur

### Tillståndshantering

- **Redux Store** – hanterar UI‑tillstånd, formulärdata och geometri via
  _Seamless Immutable_.
- **React Query** – hanterar serverdata, workspace‑metadata och caching med
  automatisk retry.

### Centrala tjänster

| Service                | Ansvar                                                    |
| ---------------------- | --------------------------------------------------------- |
| `FmeFlowApiClient`     | Kommunicerar med FME Flow REST‑API med retry och loggning |
| `ParameterFormService` | Genererar dynamiska formulär från workspace‑parametrar    |
| `VisibilityEvaluator`  | Utvärderar synlighetskedjor för formulärfält              |
| **Valideringsflöden**  | Orkestrerar uppstart, anslutning och geometrivalidering   |
| **Rittjänster**        | Hanterar `SketchViewModel`‑livscykel och AOI‑bearbetning  |

### Katalogstruktur

```text
src/
├── runtime/          # Widget‑UI och arbetsflöde
├── setting/          # Konfigurationspanel i Builder
├── shared/
│   ├── api.ts       # FME Flow API‑klient
│   ├── hooks.ts     # Custom React‑hooks
│   ├── services/    # Affärslogiklager
│   └── utils/       # Hjälpfunktioner
├── config/          # Typer, konstanter, enums, styling
└── extensions/      # Redux store och actions
```

### Dataflöde

1. **Uppstartsvalidering** – verifierar kart‑binding, konfiguration och
   FME‑anslutning.
2. **Rita AOI** – användaren ritar polygon eller rektangel i kartan.
3. **Välj workspace** – hämtar tillgängliga FME‑processer från repositoryt.
4. **Dynamiskt formulär** – genereras automatiskt från workspace‑parametrar.
5. **Skicka jobb** – orkestrerar AOI‑attach, parametrar och submission.
6. **Resultat** – hanterar nedladdning eller e‑postleverans.

### AOI‑jobbflöde

| Nod                     | Widget‑steg                                                 | API‑anrop                                    | Resultat                                                                           |
| ----------------------- | ----------------------------------------------------------- | -------------------------------------------- | ---------------------------------------------------------------------------------- |
| **Validate Config**     | `runStartupValidationFlow`, `validateWidgetStartup`         | Health/connection endpoints via klienten     | Fel leder till **Show Error**, annars fortsätt.                                    |
| **Draw AOI**            | `processDrawingCompletion`, `attachAoi`                     | –                                            | AOI sparas i Redux, area kontrolleras.                                             |
| **Configure Workspace** | `useWorkspaces`, `useWorkspaceItem`, `ParameterFormService` | `GET /repositories/{repo}/items/{workspace}` | Workspace väljs, parameterdefinitioner cachas och formulärvärden valideras lokalt. |
| **Submit Job**          | `executeJobSubmission`, `prepareSubmissionParams`           | `POST /jobs` eller `POST /jobs/submit`       | FME Flow‑jobb skapas och mode (sync/async) bestäms.                                |
| **Monitor Execution**   | `buildSubmissionSuccessResult`, React Query polling         | `GET /jobs/{id}`, `GET /jobs/{id}/result`    | Resultatlänkar hämtas, status uppdateras och notifieringar triggas.                |
| **Sync‑gren**           | `handleDirectDownload`                                      | `GET /jobs/{id}/result/files/{fileId}`       | Filer laddas direkt.                                                               |
| **Async‑gren**          | `publishJobCompletionMessage`, e‑postmaskering              | FME:s notifieringsendpoints                  | Användaren får e‑post/webhook när jobbet är klart.                                 |

---

## Kom igång med din egen widget

### Filosofi

Detta projekt är tänkt att **forkas och ägas av dig**. När du forkar skapar du
din egen version som du helt kontrollerar – anpassa, vidareutveckla och
underhåll enligt dina behov. Huvudrepositoryt fungerar som en referens och
startpunkt men din fork är självständig.

### Installation och anpassning

1. **Forka repositoryt** – skapa en egen kopia på GitHub som du äger.
2. **Klona din fork** till din lokala dator:

   ```bash
   git clone https://github.com/DITT-ANVÄNDARNAMN/fme-export-widget.git
   ```

3. **Installera beroenden**:

   ```bash
   cd client
   npm ci
   npm install @tanstack/react-query
   ```

4. **Starta utvecklingsmiljön**:

   ```bash
   npm start  # Utvecklingsserver med hot‑reload
   ```

5. **Testa lokalt** (valfritt):

   ```bash
   cd server
   npm ci
   npm start  # Lokal FME Flow‑testserver
   ```

6. **Bygg för driftsättning**:

   ```bash
   npm run build:prod              # Produktionsbygge
   npm run build:for-download      # Distribution (v1.18+)
   ```

Din widget – dina regler: anpassa arbetsflödet, gränssnittet och integrationerna
så att de passar dina FME‑workspaces och interna system.

---

## Felkoder

Avsnittet listar vanliga felkoder och deras orsaker. Använd det som
felsökningsguide.

### Konfiguration och uppstart

| Felkod                                                 | Orsak                                 | Åtgärd                                                   |
| ------------------------------------------------------ | ------------------------------------- | -------------------------------------------------------- |
| **WIDGET_ID_MISSING**                                  | Widget saknas i layout                | Lägg tillbaka widgeten och publicera                     |
| **MAP_MODULES_LOAD_FAILED**                            | ArcGIS‑moduler blockerades            | Kontrollera nätverk/CSP och ladda om                     |
| **MAP_INIT_ERROR**                                     | Ingen kartwidget är aktiv             | Koppla widgeten till webbkarta                           |
| **SKETCH_CREATE_FAILED**                               | Ritläge kunde inte starta             | Starta ritning/sidan om                                  |
| **configMissing / CONFIG_INCOMPLETE / INVALID_CONFIG** | Obligatoriska FME‑fält saknas         | Fyll i URL, token och repository. Kör “Testa anslutning” |
| **STARTUP_NETWORK_ERROR**                              | FME nåddes inte                       | Kontrollera proxy/brandvägg och `fmeServerUrl`           |
| **STARTUP_VALIDATION_FAILED / VALIDATION_FAILED**      | Generellt startfel                    | Aktivera loggning och rätta det steg som syns i konsolen |
| **CONNECTION_ERROR / REQUEST_FAILED**                  | HTTP‑anrop stoppades eller timeoutade | Höj _Request timeout_ och verifiera anslutningen         |
| **HTTPS_REQUIRED**                                     | HTTPS‑krav möter `http://`‑URL        | Uppdatera till `https` eller stäng kravet                |
| **INVALID_REQUEST_URL**                                | Ogiltig serveradress                  | Rensa extra tecken i `fmeServerUrl`                      |
| **URL_TOO_LONG / WEBHOOK_URL_TOO_LONG**                | Webhooken över ~4 000 tecken          | Minska parametrar eller välj async                       |
| **INVALID_RESPONSE_FORMAT**                            | FME svarade inte med JSON             | Säkerställ JSON‑svar och granska proxy                   |
| **UserEmailMissing / MISSING_REQUESTER_EMAIL**         | Async‑läge saknar e‑post              | Lägg in adress i profil eller default‑fält               |
| **UNKNOWN / TEST_ERROR**                               | Oklassificerat fel                    | Samla loggar och rapportera                              |

### Geometri och ritning

| Felkod                                            | Orsak                          | Åtgärd                                    |
| ------------------------------------------------- | ------------------------------ | ----------------------------------------- |
| **ABORTED**                                       | Ritning avbröts                | Rita området igen                         |
| **NO_GEOMETRY / GEOMETRY_MISSING**                | Ingen polygon skickades        | Avsluta med dubbelklick och rita om       |
| **INVALID_GEOMETRY_TYPE / GEOMETRY_TYPE_INVALID** | Fel geometri‑typ               | Exponera endast polygon/rectangle         |
| **INVALID_GEOMETRY**                              | Polygon kunde inte förenklas   | Rita enklare polygon utan självskärning   |
| **GEOMETRY_INVALID**                              | Ringar ogiltiga eller area = 0 | Säkerställ stängd polygon med ≥ 3 hörn    |
| **GEOMETRY_VALIDATION_ERROR**                     | ArcGIS‑validering kastade fel  | Ladda om kartan och kontrollera loggar    |
| **GEOMETRY_SERIALIZATION_FAILED**                 | AOI kunde inte serialiseras    | Rensa lagret och rita om                  |
| **GEOMETRY_ERROR**                                | Övrigt geometri‑fel            | Tryck “Börja om” och försök igen          |
| **AREA_TOO_LARGE**                                | AOI passerar `maxArea`         | Minska ytan eller höj gränsen             |
| **ZERO_AREA**                                     | Polygon gav 0 m²               | Rita polygon med tydliga hörn             |
| **DRAWING_COMPLETE_ERROR**                        | Efterprocess misslyckades      | Ladda om sidan; rapportera vid upprepning |

### Formulär, parametrar och jobb

| Felkod                                | Orsak                                    | Åtgärd                                                |
| ------------------------------------- | ---------------------------------------- | ----------------------------------------------------- |
| **FORM_INVALID**                      | Frontend stoppade formuläret             | Rätta markerade fält                                  |
| **PARAMETER_VALIDATION_ERROR**        | FME:s publicerade validering slog till   | Justera indata eller regler i workspace               |
| **WORKSPACE_PARAMETERS_ERROR**        | Parametrar kunde inte hämtas             | Kontrollera namn och tokenbehörighet                  |
| **WORKSPACE_ITEM_ERROR**              | Workspace hittades inte                  | Säkerställ repository och exakt namn                  |
| **REPOSITORIES_ERROR**                | Repository‑listning misslyckades         | Ge token “Read Repositories” och testa igen           |
| **REPOSITORY_ITEMS_ERROR**            | Workspace‑listning misslyckades          | Kontrollera repository‑åtkomst                        |
| **JOB_SUBMISSION_ERROR**              | `/jobs` gav 4xx/5xx                      | Läs jobbloggen och rätta felet                        |
| **SUBMISSION_ERROR**                  | Fel i `executeJobSubmission`             | Läs orderresultat och korrigera indata                |
| **SUBMISSION_UNEXPECTED_ERROR**       | Oväntat undantag                         | Aktivera loggning och rapportera                      |
| **REMOTE_DATASET_WORKSPACE_REQUIRED** | Workspace saknar parameter för fjärrdata | Lägg till publicerad parameter eller stäng funktionen |

### Data, webhookar och resultat

| Felkod                              | Orsak                            | Åtgärd                                                   |
| ----------------------------------- | -------------------------------- | -------------------------------------------------------- |
| **DATA_UPLOAD_ERROR**               | Temp‑uppladdning misslyckades    | Kontrollera filstorlek, Temp‑anslutning och token        |
| **DATA_DOWNLOAD_ERROR**             | Webhook‑download gav fel         | Kör jobbet i FME och granska nätverk                     |
| **FORMDATA_UNSUPPORTED**            | Miljön saknar `FormData`         | Använd modern webbläsare/WebView                         |
| **WEBHOOK_AUTH_ERROR**              | 401/403 eller saknad token       | Skicka `fmetoken` och kontrollera proxy                  |
| **WEBHOOK_TIMEOUT**                 | Webhook svarade inte i tid       | Optimera jobbet eller kör async                          |
| **WEBHOOK_BAD_RESPONSE / NON_JSON** | Webhook gav annat än JSON        | Säkerställ att workspace returnerar JSON                 |
| **CLIENT_DISPOSED**                 | API‑klienten stängdes            | Öppna widgeten igen innan nya anrop                      |
| **ARCGIS_MODULE_ERROR**             | ArcGIS‑moduler kunde inte laddas | Kör `npm ci`, verifiera `loadArcgisModules` och ladda om |
| **FME_JOB_FAILURE**                 | FME rapporterade _FAILED_        | Felsök transformatorn i jobbloggen                       |
| **FME_JOB_CANCELLED**               | Jobbet stoppades manuellt/policy | Starta om och kontrollera policies                       |
| **FME_JOB_CANCELLED_TIMEOUT**       | `tm_ttc`/`tm_ttl` passerades     | Höj gränserna eller använd async                         |
| **NO_RESULT**                       | Inget orderresultat sparades     | Kör export igen eller hämta från Flow                    |
| **NO_DATA**                         | Jobbet gav inga data             | Säkerställ att workspace producerar utdata               |

---

## Utveckling

### NPM‑kommandon

| Kommando             | Syfte                                     |
| -------------------- | ----------------------------------------- |
| `npm start`          | Startar utvecklingsservern med watch‑läge |
| `npm run build:dev`  | Skapar ett utvecklingsbygge               |
| `npm run build:prod` | Skapar ett minifierat produktionsbygge    |
| `npm run test`       | Kör enhetstester med Jest                 |
| `npm run lint`       | Kör ESLint                                |
| `npm run type-check` | Validerar TypeScript‑typer                |

Du kan även köra kommandona direkt i följd:

```bash
npm start
npm run build:dev
npm run build:prod
npm run test
npm run lint
npm run type-check
```

### Testning

Projektet är konfigurerat för **Jest** och **React Testing Library**. Placera
testfiler i `src/tests/` eller namnge dem `*.test.ts(x)` i källkoden. Inga
tester är implementerade ännu.

### Felsökning

Aktivera widgetens debugläge genom att köra följande i webbläsarens konsol:

```javascript
window.__FME_DEBUG__ = {
  widgetId: "widget_1", // ersätt med aktuellt widget‑ID
  config: { enableLogging: true },
};
```

**Vanliga felkällor:**

- **Ogiltig token** – kontrollera att API‑token har rätt behörigheter i FME Flow
- **Inga workspaces** – säkerställ att processer är publicerade i repositoryt och
  att token har åtkomst
- **Geometrifel** – undvik självöverlappande polygoner och kontrollera `maxArea`

---

## Vanliga frågor (FAQ)

| Fråga                                        | Svar                                                                                                              | Ref               |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ----------------- |
| **Hur kopplas kartan?**                      | Koppla widgeten till kartwidget. `JimuMapViewComponent` skapar automatiskt `GraphicsLayer` och `SketchViewModel`. | `widget.tsx`      |
| **Vilka FME‑fält krävs?**                    | Server‑URL, API‑token och repository. Testa anslutningen innan du sparar.                                         | `setting.tsx`     |
| **Hur skyddas token?**                       | Token krypteras av Experience Builder. Loggar maskeras via `maskToken`.                                           | `logging.ts`      |
| **Vad händer med stora AOI?**                | Geometrin förenklas och arean beräknas. Jobb över `maxArea` stoppas; varning visas nära gränsvärden.              | `drawing.ts`      |
| **Stöds async‑jobb?**                        | Ja. Sync ger direkt nedladdning (max 5 min); async skickar e‑post och stöder längre processer.                    | `submission.ts`   |
| **Hur felsöker jag?**                        | Aktivera loggning i Builder eller kör `window.__FME_DEBUG__`. Läs felkoder och FME Flow‑jobbloggar.               | `validation.ts`   |
| **Kan jag anpassa formulärfält?**            | Ja. Utöka `ParameterFormService` eller `fields.tsx`. Håll config immutabel.                                       | `parameters.ts`   |
| **Ska widgeten ligga i Widget Controller?**  | Starkt rekommenderat. Isolerar kartresurser och förhindrar konflikter.                                            | `widget.tsx`      |
| **Hur fungerar React Query‑caching?**        | Cachar workspace‑listor i cirka 5–10 minuter. Minskar API‑anrop och invalidation sker automatiskt.                | `query-client.ts` |
| **Sync vs async – skillnad?**                | Sync ger direkt nedladdning (max 5 min) utan e‑post. Async köar jobbet och skickar e‑post när det är klart.       | `fme.ts`          |
| **Hur fungerar fjärrdataset?**               | Användare anger HTTPS‑URL. Filen laddas temporärt via Temp‑connection. Kräver publicerad parameter.               | `dataset.ts`      |
| **Varför “saknar parameter för fjärrdata”?** | Workspace saknar publicerad parameter (default `DEST_DATASET`). Lägg till parametern eller stäng funktionen.      | `constants.ts`    |
| **Kan flera användare rita samtidigt?**      | Ja. State är widget‑scoped; endast en widget är aktiv i kartan åt gången.                                         | `store.ts`        |
| **Hur förhindras stora/långsamma exporter?** | `maxAreaM2` stoppar export; `largeAreaWarningM2` varnar; `tm_ttc`/`tm_ttl` timeout avbryter körningen.            | `drawing.ts`      |
| **Vad händer vid stängning mitt i jobb?**    | Requests avbryts, kartlager rensas, sketch stoppas, state tas bort. Serverjobb fortsätter.                        | `hooks.ts`        |
| **Vad händer vid minimering?**               | State bevaras. Inget avbryts. Fortsätt där du slutade; AOI, formulär och resultat finns kvar.                     | `store.ts`        |

> **Säkerhetscheck:** När loggning är aktiverad bör du alltid anonymisera känsliga
> parametrar i loggar via `safeLogParams` och tokens via `maskToken` innan du
> delar dem.

---

## Support och resurser

- **Diskussioner och frågor** – använd [GitHub Discussions](https://github.com/j0hanz/fme-export-widget/discussions)
- **Buggrapporter och förslag** – skapa ärenden i [GitHub Issues](https://github.com/j0hanz/fme-export-widget/issues)
- **Presentation** – se material från [FME Användarträff 2025](https://github.com/user-attachments/files/23019353/FMEAnvandartraff2025.pdf)
- **Experience Builder‑dokumentation** – [ArcGIS Experience Builder](https://developers.arcgis.com/experience-builder/)
- **ArcGIS JS API dokumentation** – [ArcGIS JS API](https://developers.arcgis.com/javascript/latest/)
- **FME Flow REST API** – [FME Flow API v4](https://docs.safe.com/fme/html/fmeapiv4/docs/index.html)
- **React** – [React‑dokumentation](https://react.dev/)
- **TanStack Query** – [TanStack Query dokumentation](https://tanstack.com/query/latest)
