# FME Export Widget

[![GitHub release](https://img.shields.io/github/v/release/j0hanz/fme-export-widget)](https://github.com/j0hanz/fme-export-widget/releases/latest)
[![FME Flow](https://img.shields.io/badge/FME%20Flow%20API-V4-orange.svg)](https://docs.safe.com/fme/html/fmeapiv4/docs/index.html)

Widget för ArcGIS Experience Builder som möjliggör självbetjäning av geodata via FME Flow. Användaren ritar ett område, väljer en FME-process (workspace), fyller i parametrar och får resultatet levererat automatiskt. Nya exporttyper blir omedelbart tillgängliga för användaren utan behov av omkonfiguration.

## Funktioner

- **Intresseområde (AOI):** Rita polygoner eller rektanglar med automatisk ytkontroll.
- **Dynamiska formulär:** Parametrar för text, nummer, val, filer och geometri genereras automatiskt från vald FME-process.
- **Flexibel körning:** Stöd för både synkron nedladdning (direkt i webbläsaren) och asynkron leverans via e-post för tidskrävande jobb.
- **Säker hantering:** Byggd med säkerhet i fokus, inklusive token-autentisering, HTTPS-validering, maskerade loggar och sanerad indata.
- **Användarstöd:** Inbyggd felhantering och möjlighet att visa anpassade supportmeddelanden.

## Installation

Följ dessa steg för att installera och konfigurera widgeten. För grundläggande instruktioner, se Esris [installationsguide för Experience Builder](https://developers.arcgis.com/experience-builder/guide/install-guide/).

### Systemkrav

- **Experience Builder:** Developer Edition 1.14+
- **ArcGIS Maps SDK for JavaScript:** 4.27+
- **FME Flow:** Server med REST API v4 aktiverat.
- **Webbkarta:** Krävs i Experience Builder-applikationen för att kunna rita område.
- **React Query:** `@tanstack/react-query` (installeras via npm).

### 1. Hämta källkoden

För att kunna anpassa och underhålla din egen version av widgeten rekommenderas det att du först skapar en "fork" av detta repository till ditt eget GitHub-konto. Klona sedan din forkade version.

```bash
git clone https://github.com/DITT-ANVÄNDARNAMN/fme-export-widget.git
```

### 2. Installera widgeten

Kopiera widget-mappen till din Experience Builder-installation och installera nödvändiga paket.

```bash
# Navigera till din Experience Builder-katalog
cd /path/to/arcgis-experience-builder-sdk

# Kopiera widgeten
cp -r /path/to/fme-export-widget/fme-export client/your-extensions/widgets/

# Installera beroenden
cd client
npm ci
npm install @tanstack/react-query
```

### 3. Bygg widgeten

Kompilera widgeten för att göra den tillgänglig i Experience Builder.

```bash
# Bygg för produktion (rekommenderas)
npm run build:prod

# Eller starta i utvecklingsläge med automatisk omladdning
npm start
```

### 4. Konfigurera i Experience Builder

Slutför konfigurationen i Experience Builder-gränssnittet.

1. **Lägg till widgeten** i din applikation.
2. **Välj en webbkarta** som widgeten ska kopplas till.
3. **Ange FME Flow-inställningar:**
   - Server-URL (t.ex. `https://fmeflow.exempel.se`)
   - API-token med nödvändiga behörigheter.
   - Välj det repository där dina FME-processer finns.
4. **Testa anslutningen** för att verifiera att allt fungerar.
5. **Spara** konfigurationen.

Alternativt kan widgeten läggas till direkt i ArcGIS Enterprise/Online via manifest-filen:
`https://j0hanz.github.io/fme-export-widget/manifest.json`

## Användning

Arbetsflödet för slutanvändaren är enkelt och intuitivt:

1. **Rita område:** Välj ritverktyg och markera ett intresseområde i kartan.
2. **Välj export:** Välj önskad FME-process från listan.
3. **Ange parametrar:** Fyll i det dynamiskt genererade formuläret.
4. **Välj leverans:** Ladda ner direkt eller få en länk via e-post.
5. **Skicka:** Starta exporten och invänta resultatet.

## Konfiguration

Widgeten erbjuder en rad inställningar för att anpassa funktionalitet och säkerhet. Alla inställningar görs i Experience Builders admin-gränssnitt.

| Inställning                | Beskrivning                                                                                                           |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| **FME Flow Server**        |                                                                                                                       |
| Server-URL                 | Adress till FME Flow, t.ex. `https://fmeflow.exempel.se`.                                                             |
| API-token                  | Token från FME Flow med behörighet för att läsa repositories och köra jobb.                                           |
| Repository                 | Namnet på det repository där publicerade FME-processer finns.                                                         |
| **Geometri & Validering**  |                                                                                                                       |
| Parameternamn för område   | Namnet på den publicerade parametern i FME som ska ta emot områdets geometri. Standard: `AreaOfInterest`.             |
| Maximal exportyta (m²)     | Högsta tillåtna yta för ett ritat område. Lämna tomt för obegränsad yta.                                              |
| Varningsgräns för yta (m²) | En varning visas om området överskrider detta värde, för att uppmärksamma användaren på potentiellt långa väntetider. |
| **Jobbhantering**          |                                                                                                                       |
| Maximal körtid (s)         | Maximal tid ett jobb får köras innan det avbryts av FME Flow. Gäller endast vid direkt nedladdning.                   |
| Timeout för förfrågan (ms) | Maximal väntetid (i millisekunder) på svar från FME Flow. Lämna tomt för att invänta svar på obestämd tid.            |
| **Filhantering**           |                                                                                                                       |
| Tillåt filuppladdning      | Låter användare ladda upp filer (t.ex. ritningar, referensdata) som indata till FME-processen.                        |
| Tillåt fjärr-URL (HTTPS)   | Tillåter användare att ange en HTTPS-URL som pekar till en datakälla.                                                 |
| Uppladdningsparameter      | Namnet på den publicerade parametern som tar emot sökvägen till en uppladdad fil.                                     |
| **Säkerhet & Meddelanden** |                                                                                                                       |
| Kräv HTTPS                 | Tvingar all kommunikation med FME Flow att använda HTTPS.                                                             |
| Maskera e-postadress       | Döljer delar av användarens e-postadress i bekräftelsevyn, t.ex. `a***@exempel.com`.                                  |
| Supportkontakt             | E-postadress eller länk som visas i felmeddelanden för att guida användaren.                                          |
| Aktivera loggning          | Aktiverar detaljerad loggning i webbläsarens konsol för felsökning. Bör endast vara aktiv under utveckling.           |

## Utveckling

### NPM-kommandon

Använd följande kommandon för att hantera utvecklingslivscykeln.

```bash
npm start         # Startar utvecklingsserver med watch-läge
npm run build:dev   # Skapar ett utvecklingsbygge
npm run build:prod  # Skapar ett minifierat produktionsbygge
npm run test        # Kör enhetstester med Jest
npm run lint        # Granskar koden med ESLint
npm run type-check  # Validerar TypeScript-typer
```

### Testning

Projektet är konfigurerat för Jest och React Testing Library. Testfiler ska placeras i `src/tests/` eller som `*.test.ts(x)` bredvid källkoden. För närvarande finns inga tester implementerade.

### Felsökning

Aktivera widgetens debug-läge genom att köra följande kommando i webbläsarens konsol:

```javascript
window.__FME_DEBUG__ = {
  widgetId: "widget_1", // Ersätt med aktuellt widget-ID
  config: { enableLogging: true },
};
```

**Vanliga felkällor:**

- **Ogiltig token:** Kontrollera att din API-token har korrekta behörigheter i FME Flow.
- **Inga workspaces:** Säkerställ att processer är publicerade till det valda repositoryt och att din token har åtkomst.
- **Geometrifel:** Undvik självöverlappande polygoner och kontrollera `maxArea`-inställningen.

## Teknisk referens

Widgeten använder **FME Flow REST API v3** för att hantera:

- Hälso- och statuskontroller av FME Flow.
- Listning av repositories och FME-processer.
- Hämtning av metadata och parametrar för en specifik process.
- Start av synkrona och asynkrona jobb.
- Filuppladdning till FME Flows temporära resurskatalog.

En framtida uppdatering kommer att portera anropen till API v4.

## Support och resurser

- **Frågor och diskussioner:** [GitHub Discussions](https://github.com/j0hanz/fme-export-widget/discussions)
- **Buggrapporter och förslag:** [GitHub Issues](https://github.com/j0hanz/fme-export-widget/issues)
- **FME Flow REST API:** [Dokumentation](https://docs.safe.com/fme/html/fmeapiv4/docs/index.html)
- **Experience Builder SDK:** [Dokumentation](https://developers.arcgis.com/experience-builder/)
- **Presentation:** [FME Användarträff 2025](https://github.com/user-attachments/files/23019353/FMEAnvandartraff2025.pdf)
