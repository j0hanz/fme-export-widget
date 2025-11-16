# FME Export Widget

[![GitHub release](https://img.shields.io/github/v/release/j0hanz/fme-export-widget?label=Version)](https://github.com/j0hanz/fme-export-widget/releases/latest)[![GitHub last commit](https://img.shields.io/github/last-commit/j0hanz/fme-export-widget?label=Updated)](https://github.com/j0hanz/fme-export-widget/commits)[![GitHub code size](https://img.shields.io/github/languages/code-size/j0hanz/fme-export-widget?label=Size)](https://github.com/j0hanz/fme-export-widget)[![FME Flow](https://img.shields.io/badge/FME%20Flow%20API-V4-orange.svg?label=FME-Flow)](https://docs.safe.com/fme/html/fmeapiv4/docs/index.html)
[![React 18.3.1](https://img.shields.io/badge/React-18.3.1-61DAFB.png?logo=react&logoColor=000000&style=flat)](https://react.dev/)[![ArcGIS Experience Builder](https://img.shields.io/badge/ArcGIS-Experience%20Builder-2C7CBE.png?logo=arcgis&logoColor=ffffff&style=flat)](https://developers.arcgis.com/experience-builder/)[![ArcGIS JS API](https://img.shields.io/badge/ArcGIS%20JS%20API-4.29-0176D2.png?logo=arcgis&logoColor=ffffff&style=flat)](https://developers.arcgis.com/javascript/latest/)[![TanStack Query](https://img.shields.io/badge/TanStack%20Query-v5-FF4154.png?logo=reactquery&logoColor=ffffff&style=flat)](https://tanstack.com/query/latest)
[![GitHub stars](https://img.shields.io/github/stars/j0hanz/fme-export-widget)](https://github.com/j0hanz/fme-export-widget/stargazers)[![GitHub forks](https://img.shields.io/github/forks/j0hanz/fme-export-widget)](https://github.com/j0hanz/fme-export-widget/network/members)[![GitHub issues](https://img.shields.io/github/issues/j0hanz/fme-export-widget)](https://github.com/j0hanz/fme-export-widget/issues)[![GitHub pull requests](https://img.shields.io/github/issues-pr/j0hanz/fme-export-widget)](https://github.com/j0hanz/fme-export-widget/pulls)[![GitHub contributors](https://img.shields.io/github/contributors/j0hanz/fme-export-widget?color=2b9348)](https://github.com/j0hanz/fme-export-widget/graphs/contributors)

---

## Snabböversikt

| Komponent          | Krav / Version                           |
| ------------------ | ---------------------------------------- |
| Experience Builder | Developer Edition 1.14+                  |
| ArcGIS JS API      | 4.29 (laddas via `loadArcgisModules`)    |
| React              | 18.3.1                                   |
| TanStack Query     | v5 (React Query 5.90)                    |
| FME Flow API       | REST API v4 med giltig token             |
| Webbkarta          | Obligatorisk (Polygon/Rectangle sketch)  |
| State              | Redux (Seamless Immutable) + React Query |

---

## Översikt

Integrera FME Flow direkt i ArcGIS Experience Builder. Användare exporterar data genom att rita ett område i kartan och fylla i ett formulär. Resultatet levereras direkt via nedladdning eller e-post – utan krav på FME-kunskaper.

**Målgrupp:** Organisationer som använder FME Flow och vill erbjuda webbaserad dataexport utan egen utveckling.

---

## Innehåll

- [Översikt](#översikt)
- [Distribution](#distribution)
- [Funktioner](#funktioner)
- [Installation](#installation)
  - [Systemkrav](#systemkrav)
  - [Installationssteg](#installationssteg)
- [Användning](#användning)
- [Konfiguration](#konfiguration)
- [Arkitektur](#arkitektur)
- [Utveckling](#utveckling)
- [Bidra till projektet](#bidra-till-projektet)
- [Felkoder](#felkoder)
- [Support och resurser](#support-och-resurser)

---

## Snabbnavigation via nyckelord

Snabb guide till de vanligaste ämnena:

| Nyckelord              | Huvudavsnitt                                                                                                                                                                   | Använd när du...                                       |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------ |
| AOI & geometri         | [Användning](#användning) · [Geometri & Validering](#geometri--validering) · [Felkoder: Geometri](#geometri-och-ritning)                                                         | ritar område, tolkar maxyta eller felsöker ritningsfel |
| FME Flow & token       | [Systemkrav](#systemkrav) · [FME Flow Server](#fme-flow-server) · [Säkerhet & Meddelanden](#säkerhet--meddelanden) · [Felkoder](#felkoder)                                      | kopplar mot servern, hanterar HTTPS eller token        |
| React Query & data     | [Snabböversikt](#snabböversikt) · [Arkitektur](#arkitektur) · [Utveckling](#utveckling)                                                                                         | behöver förstå cache och datahämtning                  |
| Builder-konfiguration  | [Konfiguration](#konfiguration) · [Jobbhantering](#jobbhantering) · [Filhantering](#filhantering)                                                                               | justerar inställningar i Experience Builder            |
| Loggning & felsökning  | [Säkerhet & Meddelanden](#säkerhet--meddelanden) · [Felsökning](#felsökning) · [Felkoder](#felkoder)                                                                            | samlar loggar eller tolkar felmeddelanden              |
| Distribution & install | [Distribution](#distribution) · [Installation](#installation) · [Bidra till projektet](#bidra-till-projektet)                                                                    | väljer version, installerar eller delar kod            |
| Arkitektur & services  | [Arkitektur](#arkitektur) · [Tillståndshantering](#arkitektur) · [Katalogstruktur](#katalogstruktur)                                                                            | ska förstå hur widgeten är uppbyggd                    |
| Support & resurser     | [Support och resurser](#support-och-resurser) · [Felöversikt](#felkoder) · [Utveckling](#utveckling)                                                                             | behöver mer dokumentation eller vill rapportera ärende |

---

## Distribution

Välj version baserat på din FME Flow-miljö:

| Version | Målmiljö    | Nedladdning                                                                                      | Status        |
| ------- | ----------- | ------------------------------------------------------------------------------------------------ | ------------- |
| v1.1    | FME Flow v4 | [Ladda ned](https://github.com/j0hanz/fme-export-widget/releases/download/v1.1/fme-export.zip)   | Rekommenderad |
| v1.0-V3 | FME Flow v3 | [Ladda ned](https://github.com/j0hanz/fme-export-widget/releases/download/1.0-V3/fme-export.zip) | Legacy        |

---

## Funktioner

| Funktion                   | Värde för användaren                                                    |
| -------------------------- | ----------------------------------------------------------------------- |
| Area of Interest (AOI)     | Rita polygoner/rektanglar med automatisk ytkontroll och varningar       |
| Dynamiska formulär         | Parameterfält genereras från vald workspace utan manuell konfigurering  |
| Flexibel körning           | Direktnedladdning eller asynkron leverans via e-post/webhook            |
| Säker hantering            | Token-autentisering, HTTPS-validering, maskerade loggar, sanerad indata |
| Användarvänligt gränssnitt | Tydligt arbetsflöde, realtidsvalidering och stödtexter                  |

---

## Installation

### Systemkrav

- **Experience Builder:** Developer Edition 1.14+
- **ArcGIS Maps SDK for JavaScript:** 4.27+
- **FME Flow:** Server med REST API v4 aktiverat
- **Webbkarta:** Krävs i Experience Builder-applikationen för att kunna rita område
- **React Query:** `@tanstack/react-query` (installeras via npm)

### Installationssteg

| Steg                                | Aktivitet                                                                   | Kommandon / Detaljer                                                   |
| ----------------------------------- | --------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| 1. Hämta källkoden                  | Forka repositoryt och klona din fork                                        | `git clone https://github.com/DITT-ANVÄNDARNAMN/fme-export-widget.git` |
| 2. Installera widgeten              | Kopiera mappen till `client/your-extensions/widgets/` och installera paket  | `cd client && npm ci && npm install @tanstack/react-query`             |
| 3. Bygg widgeten                    | Skapa produktion/utvecklingsbygge                                           | `npm run build:prod` eller `npm start`                                 |
| 4. Konfigurera i Experience Builder | Lägg till widgeten, välj webbkarta, ange FME-inställningar, testa och spara | Ange server-URL, API-token, repository och kör "Testa anslutning"      |

**Tips:** Lägg till widgeten i layouten, välj kartkälla, fyll i FME-inställningar, tryck på _Testa anslutning_ och spara konfigurationen.

Alternativt kan widgeten läggas till direkt i ArcGIS Enterprise/Online via manifest-filen:
`https://j0hanz.github.io/fme-export-widget/manifest.json`

---

## Användning

> **Widget Controller-rekommendation:** FME Export är optimerad för att ligga i en Widget Controller där flera widgets kan samexistera utan konflikt. Om du väljer att placera den direkt på sidan utan controller bör den vara den enda aktiva widgeten, annars riskerar andra widgets att ta över kartresurser eller nollställa sessionen mitt i ett flöde.

Enkelt arbetsflöde för slutanvändare:

1. **Rita område** – Markera intresseområde i kartan
2. **Välj process** – Välj FME-workspace från listan
3. **Ange parametrar** – Fyll i det genererade formuläret
4. **Välj leverans** – Direktnedladdning eller e-postlänk
5. **Skicka** – Starta exporten

---

## Konfiguration

Konfigurera funktionalitet och säkerhet via Experience Builders administrationsgränssnitt.

### FME Flow Server

| Inställning | Beskrivning                                                                |
| ----------- | -------------------------------------------------------------------------- |
| Server-URL  | Adress till FME Flow, t.ex. `https://fmeflow.exempel.se`                   |
| API-token   | Token från FME Flow med behörighet för att läsa repositories och köra jobb |
| Repository  | Namnet på det repository där publicerade FME-processer finns               |

### Geometri & Validering

| Inställning                | Beskrivning                                                               | Standard         |
| -------------------------- | ------------------------------------------------------------------------- | ---------------- |
| Parameternamn för område   | Namnet på den publicerade parametern i FME som tar emot områdets geometri | `AreaOfInterest` |
| Maximal exportyta (m²)     | Högsta tillåtna yta                                                       | Obegränsad       |
| Varningsgräns för yta (m²) | Visar varning vid stora områden som kan ge långa bearbetningstider        | Ingen varning    |

### Jobbhantering

| Inställning                | Beskrivning                                                            | Standard          |
| -------------------------- | ---------------------------------------------------------------------- | ----------------- |
| Maximal körtid (s)         | Max körtid innan FME Flow avbryter jobbet. Gäller endast synkrona jobb | Serverns standard |
| Timeout för förfrågan (ms) | Maximal väntetid på svar från FME Flow                                 | Obegränsad        |

### Filhantering

| Inställning              | Beskrivning                                                                      | Standard       |
| ------------------------ | -------------------------------------------------------------------------------- | -------------- |
| Tillåt filuppladdning    | Möjliggör uppladdning av filer som indata till workspace                         | Inaktiverad    |
| Tillåt fjärr-URL (HTTPS) | Tillåter användare att ange en HTTPS-URL som pekar till en datakälla             | Inaktiverad    |
| Uppladdningsparameter    | Namnet på den publicerade parametern som tar emot sökvägen till en uppladdad fil | `DEST_DATASET` |

### Säkerhet & Meddelanden

| Inställning          | Beskrivning                                                                         | Standard    |
| -------------------- | ----------------------------------------------------------------------------------- | ----------- |
| Kräv HTTPS           | Tvingar all kommunikation med FME Flow att använda HTTPS                            | Inaktiverad |
| Maskera e-postadress | Döljer delar av användarens e-postadress i bekräftelsevyn, t.ex. `a***@exempel.com` | Inaktiverad |
| Supportkontakt       | E-post eller länk som visas i felmeddelanden                                        | Tom         |
| Aktivera loggning    | Detaljerad loggning i webbläsarkonsolen. Endast för utveckling                      | Inaktiverad |

---

## Arkitektur

### Tillståndshantering

- **Redux Store** – UI-tillstånd, formulärdata och geometri via Seamless Immutable
- **React Query** – Serverdata, workspace-metadata och caching med automatisk retry

### Centrala Services

| Service                | Ansvar                                                   |
| ---------------------- | -------------------------------------------------------- |
| `FmeFlowApiClient`     | Kommunikation med FME Flow REST API med retry & loggning |
| `ParameterFormService` | Genererar dynamiska formulär från workspace-parametrar   |
| `VisibilityEvaluator`  | Utvärderar synlighetskedjor för formulärfält             |
| Valideringsflöden      | Orchestrerar uppstart, anslutning och geometrivalidering |
| Rittjänster            | Hanterar SketchViewModel-livscykel och AOI-bearbetning   |

### Katalogstruktur

```text
src/
├── runtime/          # Widget-UI och arbetsflöde
├── setting/          # Konfigurationspanel i Builder
├── shared/
│   ├── api.ts       # FME Flow API-klient
│   ├── hooks.ts     # Custom React hooks
│   ├── services/    # Affärslogiklager
│   └── utils/       # Hjälpfunktioner
├── config/          # Typer, konstanter, enums, styling
└── extensions/      # Redux store och actions
```

### Dataflöde

1. **Uppstartsvalidering** – Verifierar kart-binding, config och FME-anslutning
2. **Rita område (AOI)** – Användaren ritar polygon/rektangel i kartan
3. **Välj workspace** – Hämtar tillgängliga FME-processer från repository
4. **Dynamiskt formulär** – Genereras automatiskt från workspace-parametrar
5. **Skicka jobb** – Orchestrerar AOI-attach, parametrar och submission
6. **Resultat** – Hanterar nedladdning eller e-postleverans

---

## Bidra till projektet

### Utvecklingsflöde

1. **Forka & klona** – Skapa egen fork för anpassningar
2. **Branch-namn** – Prefix `feature/`, `fix/`, `docs/`
3. **Kodstil** – Single quotes, inga semicolons, Emotion CSS-in-JS
4. **Commits** – Conventional Commits-format

### Testkrav

- Placera tester i `src/tests/` eller som `*.test.ts(x)` bredvid källkoden
- Använd Jest + React Testing Library (`jimu-for-test`)
- Mocka ArcGIS-moduler med `__ESRI_TEST_STUB__`
- Stubba nätverksanrop och FME Flow-endpoints
- Kör `npm run test` innan du skickar in ändringar

### Checklista innan PR

- [ ] `npm run lint` går igenom
- [ ] `npm run type-check` går igenom
- [ ] `npm run test` går igenom
- [ ] Översättningar uppdaterade (Svenska/Engelska)
- [ ] Token-maskning tillämpat i loggar
- [ ] Config-sanering implementerad

### Pull Request

1. Beskriv ändringar och syfte
2. Bifoga skärmdumpar vid UI-ändringar
3. Referera relaterade issues
4. Invänta review och CI-kontroller

---

## Felkoder

### Konfiguration och uppstart

| Felkod                                             | Orsak                                 | Åtgärd                                                   |
| -------------------------------------------------- | ------------------------------------- | -------------------------------------------------------- |
| WIDGET_ID_MISSING                                  | Widget saknas i layout                | Lägg tillbaka widgeten och publicera                     |
| MAP_MODULES_LOAD_FAILED                            | ArcGIS-moduler blockerades            | Kontrollera nätverk/CSP och ladda om                     |
| MAP_INIT_ERROR                                     | Ingen kartwidget är aktiv             | Koppla widgeten till webbkarta                           |
| SKETCH_CREATE_FAILED                               | Ritläge kunde inte starta             | Starta ritning/sida om                                   |
| configMissing / CONFIG_INCOMPLETE / INVALID_CONFIG | Obligatoriska FME-fält saknas         | Fyll i URL, token och repository, kör "Testa anslutning" |
| STARTUP_NETWORK_ERROR                              | FME nåddes inte                       | Kontrollera proxy/brandvägg och `fmeServerUrl`           |
| STARTUP_VALIDATION_FAILED / VALIDATION_FAILED      | Generellt startfel                    | Slå på logging och rätta det steg som syns i konsolen    |
| CONNECTION_ERROR / REQUEST_FAILED                  | HTTP-anrop stoppades eller timeoutade | Höj "Request timeout (ms)" och verifiera anslutning      |
| HTTPS_REQUIRED                                     | HTTPS-krav möter http://-URL          | Uppdatera till https eller stäng kravet                  |
| INVALID_REQUEST_URL                                | Ogiltig serveradress                  | Rensa extra tecken i `fmeServerUrl`                      |
| URL_TOO_LONG / WEBHOOK_URL_TOO_LONG                | Webhooken över ~4 000 tecken          | Minska parametrar eller välj async                       |
| INVALID_RESPONSE_FORMAT                            | FME svarade inte med JSON             | Säkerställ JSON-svar och granska proxyn                  |
| UserEmailMissing / MISSING_REQUESTER_EMAIL         | Async-läge saknar e-post              | Lägg in adress i profil eller defaultfält                |
| UNKNOWN / TEST_ERROR                               | Oklassificerat fel                    | Samla loggar och rapportera                              |

### Geometri och ritning

| Felkod                                        | Orsak                          | Åtgärd                                    |
| --------------------------------------------- | ------------------------------ | ----------------------------------------- |
| ABORTED                                       | Ritning avbröts                | Rita området igen                         |
| NO_GEOMETRY / GEOMETRY_MISSING                | Ingen polygon skickades        | Avsluta med dubbelklick och rita om       |
| INVALID_GEOMETRY_TYPE / GEOMETRY_TYPE_INVALID | Fel geometri-typ               | Exponera endast polygon/rectangle         |
| INVALID_GEOMETRY                              | Polygon kunde inte förenklas   | Rita enklare polygon utan självskärning   |
| GEOMETRY_INVALID                              | Ringar ogiltiga eller area = 0 | Säkerställ stängd polygon med ≥3 hörn     |
| GEOMETRY_VALIDATION_ERROR                     | ArcGIS validering kastade fel  | Ladda om kartan och kontrollera loggar    |
| GEOMETRY_SERIALIZATION_FAILED                 | AOI kunde inte serialiseras    | Rensa lagret och rita om                  |
| GEOMETRY_ERROR                                | Övrigt geometri-fel            | Tryck "Börja om" och försök igen          |
| AREA_TOO_LARGE                                | AOI passerar `maxArea`         | Minska ytan eller höj gränsen             |
| ZERO_AREA                                     | Polygon gav 0 m²               | Rita polygon med tydliga hörn             |
| DRAWING_COMPLETE_ERROR                        | Efterprocess misslyckades      | Ladda om sidan, rapportera vid upprepning |

### Formulär, parametrar och jobb

| Felkod                            | Orsak                                    | Åtgärd                                                |
| --------------------------------- | ---------------------------------------- | ----------------------------------------------------- |
| FORM_INVALID                      | Frontend stoppade formuläret             | Rätta markerade fält                                  |
| PARAMETER_VALIDATION_ERROR        | FME:s publicerade validering slog till   | Justera indata eller regler i workspace               |
| WORKSPACE_PARAMETERS_ERROR        | Parameterdefinitioner kunde inte hämtas  | Kontrollera namn och tokenbehörighet                  |
| WORKSPACE_ITEM_ERROR              | Workspacen hittades inte                 | Säkerställ repository och exakt namn                  |
| REPOSITORIES_ERROR                | Repository-listning misslyckades         | Ge token "Read Repositories" och testa igen           |
| REPOSITORY_ITEMS_ERROR            | Workspace-listning misslyckades          | Kontrollera repository-åtkomst                        |
| JOB_SUBMISSION_ERROR              | `/jobs` gav 4xx/5xx                      | Läs jobbloggen och rätta felet                        |
| SUBMISSION_ERROR                  | Fel i `executeJobSubmission`             | Läs orderresultat och korrigera indata                |
| SUBMISSION_UNEXPECTED_ERROR       | Oväntat undantag                         | Aktivera logging och rapportera                       |
| REMOTE_DATASET_WORKSPACE_REQUIRED | Workspace saknar parameter för fjärrdata | Lägg till publicerad parameter eller stäng funktionen |

### Data, webhookar och resultat

| Felkod                                  | Orsak                            | Åtgärd                                                   |
| --------------------------------------- | -------------------------------- | -------------------------------------------------------- |
| DATA_UPLOAD_ERROR                       | Temp-uppladdning misslyckades    | Kontrollera filstorlek, Temp-anslutning och token        |
| DATA_DOWNLOAD_ERROR                     | Webhook-download gav fel         | Kör jobbet i FME och granska nätverk                     |
| FORMDATA_UNSUPPORTED                    | Miljön saknar `FormData`         | Använd modern webbläsare/WebView                         |
| WEBHOOK_AUTH_ERROR                      | 401/403 eller saknad token       | Skicka `fmetoken` och kontrollera proxy                  |
| WEBHOOK_TIMEOUT                         | Webhook svarade inte i tid       | Optimera jobbet eller kör async                          |
| WEBHOOK_BAD_RESPONSE / WEBHOOK_NON_JSON | Webhook gav annat än JSON        | Säkerställ att workspace returnerar JSON                 |
| CLIENT_DISPOSED                         | API-klienten stängdes            | Öppna widgeten igen innan nya anrop                      |
| ARCGIS_MODULE_ERROR                     | ArcGIS-moduler kunde inte laddas | Kör `npm ci`, verifiera `loadArcgisModules` och ladda om |
| FME_JOB_FAILURE                         | FME rapporterade FAILED          | Felsök transformatorn i jobbloggen                       |
| FME_JOB_CANCELLED                       | Jobbet stoppades manuellt/policy | Starta om och kontrollera policies                       |
| FME_JOB_CANCELLED_TIMEOUT               | `tm_ttc`/`tm_ttl` passerades     | Höj gränserna eller använd async                         |
| NO_RESULT                               | Inget orderresultat sparades     | Kör export igen eller hämta från Flow                    |
| NO_DATA                                 | Jobbet gav inga data             | Säkerställ att workspace producerar utdata               |

---

## Utveckling

### NPM-kommandon

| Kommando             | Syfte                                    |
| -------------------- | ---------------------------------------- |
| `npm start`          | Startar utvecklingsserver med watch-läge |
| `npm run build:dev`  | Skapar ett utvecklingsbygge              |
| `npm run build:prod` | Skapar ett minifierat produktionsbygge   |
| `npm run test`       | Kör enhetstester med Jest                |
| `npm run lint`       | Granskar koden med ESLint                |
| `npm run type-check` | Validerar TypeScript-typer               |

```bash
npm start
npm run build:dev
npm run build:prod
npm run test
npm run lint
npm run type-check
```

### Testning

Konfigurerat för Jest och React Testing Library. Placera testfiler i `src/tests/` eller som `*.test.ts(x)` vid källkoden. Inga tester implementerade ännu.

### Felsökning

Aktivera widgetens debug-läge genom att köra följande kommando i webbläsarens konsol:

```javascript
window.__FME_DEBUG__ = {
  widgetId: "widget_1", // Ersätt med aktuellt widget-ID
  config: { enableLogging: true },
};
```

**Vanliga felkällor:**

- **Ogiltig token** – Kontrollera att din API-token har korrekta behörigheter i FME Flow
- **Inga workspaces** – Säkerställ att processer är publicerade till det valda repositoryt och att din token har åtkomst
- **Geometrifel** – Undvik självöverlappande polygoner och kontrollera `maxArea`-inställningen

---

## Support och resurser

- **Frågor och diskussioner** – [GitHub Discussions](https://github.com/j0hanz/fme-export-widget/discussions)
- **Buggrapporter och förslag** – [GitHub Issues](https://github.com/j0hanz/fme-export-widget/issues)
- **FME Flow REST API** – [Dokumentation](https://docs.safe.com/fme/html/fmeapiv4/docs/index.html)
- **Experience Builder SDK** – [Dokumentation](https://developers.arcgis.com/experience-builder/)
- **Presentation** – [FME Användarträff 2025](https://github.com/user-attachments/files/23019353/FMEAnvandartraff2025.pdf)
