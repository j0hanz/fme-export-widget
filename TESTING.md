# FME Export Widget — Manuell testplan

## Förutsättningar (miljö och versionsmatris)

- ArcGIS Experience Builder: 1.18
- ArcGIS JS API: 4.29 (krav). Inga direkta importer av `@arcgis/core` i runtime; endast lazy‑load via loaders.
- Operativsystem: Windows 10/11
- Webbläsare: Chrome (senaste), Edge (senaste)
- Testdata: FME Flow‑instans (staging) över HTTPS med giltig token; minst ett repository med en workspace som innehåller parametrar av flera typer, inklusive password‑typ.
- Åtkomst: Testkonto med e‑post i ArcGIS Enterprise/Online.

## Stegmall (Given/When/Then)

- Givet: Förutsättningar och ingångsvärden
- När: Användaren utför en åtgärd
- Då: Förväntat resultat (verifierbart, gärna med bevis i Nätverk/Console/Redux)

## Översikt och dataflöde

- Indata
  - Builder‑konfiguration: `fmeServerUrl`, `fmeServerToken`, `repository`, valfria direktiv (`tm_*`), AOI‑parameternamn, fjärrdataset‑flaggor, `service`‑typ, `syncMode`, `maxArea`, `drawingColor`, `supportEmail`, `requestTimeout`.
  - Runtime: Kart­ritning (Sketch -> polygon), val av Workspace, dynamiska formulärvärden (Parameters), valfritt fjärrdataset (URL eller uppladdning), schemaläggningsfält när det är tillåtet.
- Bearbetning
  - Startkontroll: `validateWidgetStartup()` kontrollerar konfiguration + FME‑anslutning + användarens e‑post (endast asynkront läge).
  - Ritning: Geometri valideras med `validatePolygon()`; yta beräknas via `calcArea()` och begränsas av `config.maxArea`.
  - Workspace‑lista/detaljer/parametrar hämtas via `FmeFlowApiClient` (REST v3). Ingen direkt fetch förutom webhook och streaming enligt skyddsräcken.
  - Inskick: `prepFmeParams()` + `attachAoi()` + admin `applyDirectiveDefaults()`; tjänstväg enligt `service` (download eller stream). Download använder webhook (GET + `opt_*`); stream använder POST (Blob‑svar).
- State
  - Redux store‑nyckel: `fme-state` -> `byId[widgetId]` med `FmeWidgetState`. Lagrar serialiserbar data (geometri‑JSON, formulärvärden maskerade för lösenordstyper, vy‑läge etc.).
  - Inga ArcGIS JSAPI‑objekt i Redux; de lever i komponenttillstånd/refs endast.
  - Vy‑lägen: `STARTUP_VALIDATION` -> `DRAWING` -> `WORKSPACE_SELECTION` -> `EXPORT_FORM` -> `ORDER_RESULT` med korrekta tillbaka‑stigar.

## Checklista för testberedskap

- [ ] FME Flow‑URL i staging över HTTPS och en giltig token (maskas i dokument/loggar som ****1234). Ett test‑repository med minst en workspace som har parametrar av flera typer (text/nummer/väljare/datum/tid/färg/fil/intervall etc.).
- [ ] ExB‑appen har exakt en Kart‑widget konfigurerad och åtkomlig, och den här widgeten finns på en sida.
- [ ] Ett testkonto med e‑post i ArcGIS Enterprise/Online så att `SessionManager.getInstance().getUserInfo()` returnerar en giltig e‑post för asynkront läge.
- [ ] Öppna webbläsarens konsol för att observera säkra loggar; använd Nätverkspanelen för att verifiera förfrågningarnas form och headers.

**Kommentarer:** ____________________________________________________________________________________________

## Builder (inställningar)

### 1. Normalisering och validering av server‑URL

- [ ] Ange en URL med avslutande sökväg som <https://host/fmerest> eller <https://host/fmeserver>; lämna fältet (blur)
  - Förväntat: URL normaliseras till <https://host> (ingen /fmerest‑del, ingen avslutande snedstreck). Felläget rensas om giltig.
- [ ] Ange ogiltiga scheman (ftp://, file://) eller inkludera query/hash/inloggningsuppgifter; lämna fältet
  - Förväntat: Inline‑fel för ogiltig server‑URL; sanerat värde sparas inte.
- [ ] Ange ett enkelt värdnamn utan punkt i strikta sammanhang
  - Förväntat: I strikt validering (anslutningstest) anses URL ogiltig; inline‑fel visas.

**Kommentarer:** ____________________________________________________________________________________________

### 2. Tokenvalidering

- [ ] Ange token kortare än 10 tecken eller med blanksteg/kontroll/specialtecken `< > " '`
  - Förväntat: Inline‑fel “ogiltig token”; värdet kan fortfarande redigeras; skickas inte till servern.

**Kommentarer:** ____________________________________________________________________________________________

### 3. Arbetsflöde för Anslutningstest

- [ ] Med giltig URL+token och ett giltigt repository i konfigurationen, klicka “Test connection”
  - Förväntat: Steg visar kontroll -> ok; versionssträng fylls; framgångs‑alert visas.
- [ ] Med ogiltig token (401) men nåbar server
  - Förväntat: Steg: server ok, token fel; felmeddelande lokaliserat; repository‑listan oförändrad/tömd.
- [ ] Med onåbar server eller nätverksproblem
  - Förväntat: Steg: server fel; token/repository hoppas över; felmeddelande indikerar server/nätverksproblem.
- [ ] Avbryt testet genom att snabbt navigera bort
  - Förväntat: Ingen krasch; state återgår till idle; inga varningar om setState efter unmount.
- [ ] Ändra `fmeServerUrl` eller `fmeServerToken` live medan widgeten är öppen; kör “Test connection” igen
  - Förväntat: Startup‑validering körs om; state som beror på tidigare anslutning nollställs utan varningar; inga inaktuella uppdateringar.
- [ ] Samma‑värd vs annan domän
  - Förväntat: Vid samma värd syns `Authorization: fmetoken token=****` och `fmetoken` som query vid REST v3; vid annan domän används interceptor och CORS preflight passerar.

**Kommentarer:** ____________________________________________________________________________________________

### 4. Val av Repository

- [ ] Efter lyckat anslutningstest, öppna väljaren
  - Förväntat: Listan visar repositories; val uppdaterar `config.repository` och rensar workspace‑state.
- [ ] Klicka på uppdateringsikonen
  - Förväntat: Repositories laddas om; fel visas som icke‑blockerande hint; ingen krasch.
- [ ] Om listan är tom tillåts manuell textinmatning utan fel.

**Kommentarer:** ____________________________________________________________________________________________

### 5. Tjänstinställningar

- [ ] Växla Tjänsttyp till “Download” och slå på/av “Sync mode”
  - Förväntat: `config.service=download`, `syncMode` växlas; inga builder‑fel.
- [ ] Växla Tjänsttyp till “Stream” (sync‑växeln dold)
  - Förväntat: `config.service=stream` sparas; runtime ska strömma blobs.

Not: Sync‑läge väntar på jobbresultat i svaret; Async ger bekräftelse och notifiering (e‑post) när konfigurerat.

**Kommentarer:** ____________________________________________________________________________________________

### 6. Schemaläggning och jobbdirektiv

- [ ] Slå på “Allow Schedule Mode”
  - Förväntat: Runtime Export Form visar schemaläggningsfält (start/namn/kategori/beskrivning).
- [ ] Sätt `tm_ttc`, `tm_ttl` till positiva heltal; sätt `tm_tag` (<=128 tecken); lämna varje fält
  - Förväntat: `tm_ttc`/`tm_ttl` sparas som positiva heltal och `tm_tag` som text; ogiltigt/tomt rensar inställningen; vid inskick mappas de till TMDirectives (ttc/ttl/tag) i jobbförfrågan.

**Kommentarer:** ____________________________________________________________________________________________

### 7. Alternativ för fjärrdataset

- [ ] Slå på “Allow Remote Dataset Upload”
  - Förväntat: Runtime Export Form visar filuppladdningsfält.
- [ ] Slå på “Allow Remote Dataset URL (opt_geturl)”
  - Förväntat: Runtime Export Form visar URL‑fält; endast https accepteras.

**Kommentarer:** ____________________________________________________________________________________________

### 8. AOI‑ och uppladdningsparametrar

- [ ] Sätt `aoiParamName` till eget (t.ex. MyAOI); lämna fältet
  - Förväntat: Sparas som sanerat namn; runtime‑inskick använder denna nyckel med serialiserad polygon‑JSON.
- [ ] Sätt valfritt `aoiGeoJsonParamName`/`aoiWktParamName`
  - Förväntat: När de finns bifogas härledd GeoJSON (stringifierad) och WKT i inskick.
- [ ] Sätt `uploadTargetParamName` (t.ex. SourceDataset); lämna fältet
  - Förväntat: Uppladdning tilldelar returnerad `path` till denna parameter om satt.

**Kommentarer:** ____________________________________________________________________________________________

### 9. Maxyta och tidsgräns för begäran

- [ ] Sätt maxyta till ett positivt tal (m²); lämna fältet
  - Förväntat: Sparas; runtime upprätthåller; ogiltigt/0 rensar; över gräns visar inline‑fel och sparas inte.
- [ ] Sätt tidsgräns för begäran (ms) till ett positivt värde under 600 000; lämna fältet
  - Förväntat: Sparas; ogiltigt rensar; används av API‑klienten.

**Kommentarer:** ____________________________________________________________________________________________

### 10. Support‑e‑post och ritfärg

- [ ] Ange giltig e‑post; lämna fältet
  - Förväntat: Sparas; används för att visa supporthintar.
- [ ] Välj ritfärg (hex)
  - Förväntat: Sparas; runtime‑skiss/markeringssymboler använder färgen direkt.

**Kommentarer:** ____________________________________________________________________________________________

## Runtime — Startkontroll och navigering

### 11. Startkontrollens tillstånd

- [ ] Vid laddning visar widgeten valideringsmeddelanden (kartkonfig, anslutning, användar‑e‑post vid async)
  - Förväntat: `viewMode=STARTUP_VALIDATION`; laddande StateView med lokaliserat meddelande.
- [ ] Med kompletta och giltiga inställningar och en karta konfigurerad
  - Förväntat: Går vidare till `DRAWING`‑läge; inget fel visas.
- [ ] Med saknade/ogiltiga inställningar
  - Förväntat: Fel‑StateView med vägledning att öppna inställningar; Försök igen‑knapp kör om validering.
- [ ] I asynkront läge men användaren saknar e‑post eller har ogiltig e‑post
  - Förväntat: Felvy som anger att användarens e‑post saknas; försök igen är tillgängligt.

**Kommentarer:** ____________________________________________________________________________________________

### 12. Kartbindning

- [ ] Med exakt en Kart‑widget när sidan öppnas
  - Förväntat: `JimuMapViewComponent` kopplas; ett GraphicsLayer läggs till; SketchViewModel skapas.
- [ ] Stäng och öppna widgeten igen
  - Förväntat: Vid stängning nollställs ritningen; vid öppning kan validering köras om och ritresurser initieras på nytt.

**Kommentarer:** ____________________________________________________________________________________________

### 13. Vyövergångar och tillbaka‑beteende

- [ ] Från DRAWING, tryck Tillbaka (avbryt i header) när det går
  - Förväntat: Återgår till INITIAL (läge‑flikar) eller föregående state enligt styrning.
- [ ] Från EXPORT_FORM, tryck Tillbaka
  - Förväntat: Går till WORKSPACE_SELECTION.

**Kommentarer:** ____________________________________________________________________________________________

## Runtime — Ritning och geometri­validering

### 14. Ritlägen och instruktioner

- [ ] I INITIAL syns flikarna polygon/rektangel med verktygstips
  - Förväntat: Val av flik sätter ritverktyg; auto‑start börjar i DRAWING när clickCount===0.
- [ ] Meddelanden vid polygonritning
  - Förväntat: 0 klick -> “starta”; 1–2 klick -> “fortsätt”; 3+ klick -> “avsluta”.

**Kommentarer:** ____________________________________________________________________________________________

### 15. Geometrivalidering

- [ ] Rita en giltig polygon (enkel, sluten) med area > 0
  - Förväntat: Grafiken markeras; Redux `geometryJson` sätts; `drawnArea>0`; gå vidare till WORKSPACE_SELECTION.
- [ ] Rita en självskärande polygon
  - Förväntat: Validering misslyckas; fel visas (“polygonen är inte enkel”); vy återgår till INITIAL; ritningen nollställs.
- [ ] Rita med noll/nästan noll area (degenererad)
  - Förväntat: Fel “ogiltig geometri/noll area”; stannar i ritkonteksten; fortsätter inte.
- [ ] Sätt `maxArea` lågt och rita större polygon
  - Förväntat: Valideringen hindrar fortsatt; felmeddelande om för stor area.
- [ ] Rita en polygon med hål (flera ringar) där innerringen ligger utanför yttre ringen
  - Förväntat: Validering misslyckas; fel “ogiltig geometri”. Om hålet ligger helt inom yttre ring godkänns geometrin.

**Kommentarer:** ____________________________________________________________________________________________

## Runtime — Val av workspace och laddning

### 16. Laddning av workspace‑lista

- [ ] Gå in i WORKSPACE_SELECTION; observera laddning
  - Förväntat: Laddande StateView följt av knapplista; fel visar försök igen/tillbaka; tom lista visar “inga workspaces hittades”.
- [ ] Klicka en workspace
  - Förväntat: Parametrar och detaljer hämtas; valet dispatchas till store; övergång till EXPORT_FORM.
- [ ] Repository‑byte i runtime (om appen uppdaterar config)
  - Förväntat: Workspace‑state rensas; lista laddas om för nytt repository.

**Kommentarer:** ____________________________________________________________________________________________

## Runtime — Exportformulär

### 17. Dynamisk rendering av parametrar

- [ ] Verifiera att fält mappas till parametertyper (select/multi, number/integer, textarea, switch, radio, date/time/datetime, color, slider, file, url, message). Notera: “tag” och “hidden” renderas inte i runtime.
  - Förväntat: Etiketter från beskrivning/namn; standardvärden tillämpas; obligatoriskt markeras; alternativ lokaliseras.
- [ ] Väljare med ett enda alternativ väljs automatiskt och är inaktiverad
  - Förväntat: Värde sätts automatiskt; kontrollen inaktiveras; formuläret förblir giltigt.
- [ ] Password‑typ parameter
  - Förväntat: UI visar maskning (••••); Redux‑state lagrar maskerad sträng via `sanitizeFormValues()`; ingen klartext i loggar eller state.

**Kommentarer:** ____________________________________________________________________________________________

### 18. Formulärvalidering

- [ ] Obligatoriska fält tomma -> skicka in
  - Förväntat: Fel i store (`FORM_INVALID`), fältfel visas.
- [ ] Numeriska fält med icke‑numeriskt innehåll
  - Förväntat: Inline‑valideringsfel; kan inte skicka in.
- [ ] När schemaläggning är tillåten: sätt Start via väljaren; rensa sedan
  - Förväntat: När det anges måste Start matcha ÅÅÅÅ‑MM‑DD HH:mm:ss; tomt är tillåtet.
- [ ] Datum/tid ogiltiga inmatningar och tidszoner
  - Förväntat: Ogiltiga datum/tider ger inline‑fel; tidszonspåverkan visas endast som ytformattering; interna värden normaliseras.

**Kommentarer:** ____________________________________________________________________________________________

### 19. Fjärrdataset (URL och uppladdning)

- [ ] Med “Allow Remote URL” på, klistra in en giltig https‑URL
  - Förväntat: Vid inskick inkluderas `opt_geturl=<url>`; ingen uppladdning sker.
- [ ] Med ogiltig URL (http, inloggningsuppgifter, felaktig)
  - Förväntat: `opt_geturl` sätts inte; om uppladdning finns och är tillåten används den; annars bifogas ingen dataset‑parameter.
- [ ] Med “Allow Remote Dataset Upload” på, välj en lokal fil
  - Förväntat: Filnamn visas; vid inskick laddas filen upp till temp; returnerad `path` tilldelas `uploadTargetParamName` eller ett lämpligt fil‑parameter; ingen tokenläcka.
- [ ] Stor fil (>50 MB) uppladdning och avbryt
  - Förväntat: UI fryser inte; progress/cancel fungerar; AbortSignal stoppar uppladdning utan läckor; ingen kvarstående temporär state.

**Kommentarer:** ____________________________________________________________________________________________

## Runtime — Inskicksflöden och resultat

### 20. Download‑tjänst (webhook, GET)

- [ ] Service=download; async‑läge; giltigt formulär och AOI
  - Förväntat: Webhook‑GET till `/fmedatadownload/<repo>/<workspace>?opt_*&token=****`; JSON‑svar; vid framgång -> ORDER_RESULT visar bekräftelse och maskerad e‑post (om konfigurerat).
- [ ] Sync‑läge
  - Förväntat: Bekräftelsetext anpassad för sync (ingen rad med notifierings‑e‑post i resultatet).
- [ ] URL‑längd överskrids (stora parametrar)
  - Förväntat: Klienten avbryter med URL_TOO_LONG; fel mappas till lokaliserat “URL för lång”; ORDER_RESULT visar felmeddelande.
- [ ] `opt_geturl` med lång query i kombination med många formulärfält (gränsfall)
  - Förväntat: Vid överskriden `esriConfig.request.maxUrlLength` avbryts med URL_TOO_LONG; rekommendera streaming/uppladdning som alternativ.

**Kommentarer:** ____________________________________________________________________________________________

### 21. Streaming‑tjänst (POST)

- [ ] Service=stream; skicka in giltigt formulär
  - Förväntat: POST form‑urlencoded till `/fmedatastreaming/<repo>/<workspace>?token=****`; Blob returneras; ORDER_RESULT ger en nedladdningslänk och filnamn när tillgängligt.
- [ ] Content‑Disposition och filnamn
  - Förväntat: Om header finns används filnamn i UI; annars visas rimligt fallback‑namn (inte “untitled”).

**Kommentarer:** ____________________________________________________________________________________________

### 22. Felhantering och mappning

- [ ] Webhook returnerar HTML eller icke‑JSON
  - Förväntat: Behandlas som `WEBHOOK_AUTH_ERROR`; lokaliserat meddelande; ORDER_RESULT visar fel.
- [ ] 401/403‑fel var som helst i klient‑API:t
  - Förväntat: Fel mappas till token/auth‑kategori; användarmeddelande exponerar inte intern information; supporthint visas när konfigurerat.
- [ ] Nätverket offline mitt i flödet
  - Förväntat: Laddning visas; fel mappas till nätverksfel; försök igen och ladda om är tillgängliga.
- [ ] Timeout (server svarar långsamt > `requestTimeout`)
  - Förväntat: Begäran avbryts med tydligt timeout‑fel; “Försök igen” återställer; inga inaktuella uppdateringar.

**Kommentarer:** ____________________________________________________________________________________________

### 23. Resultatvy för order

- [ ] Framgång (nedladdnings‑URL eller Blob)
  - Förväntat: Titel “Orderbekräftelse/Slutförd”; nedladdningslänk finns för URL/Blob; jobId/workspace visas när tillgängligt; e‑post maskeras när `maskEmailOnSuccess` är true och async‑läge.
- [ ] Fel
  - Förväntat: Titel “Orderfel”; meddelande med lokaliserad orsak + valfri supporthint; kod visas när tillämpligt; “Försök igen” går tillbaka.

**Kommentarer:** ____________________________________________________________________________________________

## Säkerhet, integritet och logghygien

### 24. Tokenhygien och loggar

- [ ] Inspektera konsolloggar under inskick
  - Förväntat: Tokens maskeras som ****1234; endast vitlistade parametrar loggas; fullständiga URL:er med tokens loggas aldrig.
- [ ] Inspektera Redux‑state
  - Förväntat: Inga tokens lagras; formulärvärden av lösenordstyp maskeras av `sanitizeFormValues()`; endast serialiserbar data finns.
- [ ] Negativ kontroll av loggar
  - Förväntat: Inga fullständiga webhook‑URL:er med `token` loggas; endast vitlistade `opt_*` parametrar syns i loggar.
- [ ] Lagring
  - Förväntat: Varken Redux‑DevTools export eller `localStorage` innehåller några tokens.

**Kommentarer:** ____________________________________________________________________________________________

### 25. URL/värdvalidering och HTTPS

- [ ] Fjärrdataset‑URL (opt_geturl): icke‑HTTPS eller URL med inloggningsuppgifter
  - Förväntat: Avvisas; läggs inte till i parametrar.
- [ ] Server‑URL i builder: måste vara HTTPS i strikta sammanhang
  - Förväntat: Fel vid ogiltigt schema.

**Kommentarer:** ____________________________________________________________________________________________

### 26. AOI och hantering av geometrier

- [ ] Säkerställ att AOI‑JSON‑strängen bifogas under konfigurerat parameternamn; när `aoiGeoJsonParamName`/`aoiWktParamName` är satta, verifiera extra utdata
  - Förväntat: GeoJSON stringifieras; WKT som textpolygon; inga undantag om transform saknas (faller tillbaka graciöst).
- [ ] Polygon som korsar datumlinjen (±180°)
  - Förväntat: Validering/area fungerar enligt stöd; om blockerat visas begripligt fel.
- [ ] Mycket liten polygon (nära noll men >0)
  - Förväntat: Hanteras konsekvent: antingen godkänns och mäts eller blockeras med tydligt fel.

**Kommentarer:** ____________________________________________________________________________________________

### 27. Avbryt/annullera

- [ ] Starta inskick och klicka omedelbart Återställ/stäng widgeten
  - Förväntat: AbortSignal avbryter pågående begäran utan ohanterade fel; UI återgår till ritning; inga inaktuella state‑uppdateringar.
- [ ] Två snabba, parallella inskick
  - Förväntat: Tidigare begäran avbryts; endast senaste lever; inga dubbletter i ORDER_RESULT.

**Kommentarer:** ____________________________________________________________________________________________

## Tillgänglighet (WCAG 2.1 AA)

### 28. Tangentbordsnavigering

- [ ] Tabba genom alla interaktiva element (flikar, knappar, inmatningar)
  - Förväntat: Synligt fokus; logisk ordning; Enter/Space aktiverar knappar; Esc stänger öppna tooltips.
- [ ] Dynamiskt formulär (adderade/validerade fält)
  - Förväntat: Tabbordning förblir korrekt när fält dyker upp/försvinner; ingen “tab‑trap”.

**Kommentarer:** ____________________________________________________________________________________________

### 29. Skärmläsarsemantik

- [ ] StateView för laddning/fel/tomt/framgång har lämpliga roller och aria‑live
  - Förväntat: Skärmläsare annonserar tillståndsbyten och fel.
- [ ] Formulärfält har etiketter, beskrivningar och felkoppling via `aria-describedby`
  - Förväntat: Obligatoriskt fält indikeras och annonseras.
- [ ] Live‑uppdatering av fel
  - Förväntat: När fältfel åtgärdas uppdateras `aria-describedby`/aria‑live så att skärmläsare meddelar ändringen.

**Kommentarer:** ____________________________________________________________________________________________

### 30. Visuell kontrast och innehåll

- [ ] Högkontrastteman
  - Förväntat: Text förblir läsbar; knappar och länkar har tillräcklig kontrast.

**Kommentarer:** ____________________________________________________________________________________________

## Flera instanser och livscykel

### 31. Två widgetinstanser på samma sida/app (med olika ID:n)

- [ ] Interagera med båda oberoende (rita, välj workspaces, skicka in)
  - Förväntat: States isoleras per `byId[widgetId]`; åtgärder korsar inte.

**Kommentarer:** ____________________________________________________________________________________________

### 32. Livscykelstädning

- [ ] Ta bort Kart‑widgeten / ändra vald Karta i builder
  - Förväntat: Startkontroll körs om vid behov; ritresurser städas utan läckor.

**Kommentarer:** ____________________________________________________________________________________________

## Internationalisering

### 33. Lokaliseringsnycklar

- [ ] Byt appens språk
  - Förväntat: Alla användartexter är lokaliserade; inga råa nycklar; datum/tal formaterade per locale (ytformattering).

**Kommentarer:** ____________________________________________________________________________________________

## Felsökningsguide (förväntade svar)

- Start visar upprepad valideringsmiss med koden CONFIG_INCOMPLETE
  - Åtgärd: Öppna Builder‑inställningar, fyll i obligatoriska fält, kör Test connection, Spara. Förvänta övergång till DRAWING.
- Ritning slutförs men stannar i INITIAL
  - Åtgärd: Geometri ogiltig eller area noll/för stor; rätta polygonen eller minska area. Förvänta felmeddelande och ny chans.
- Workspace‑lista tom
  - Åtgärd: Säkerställ att repository har workspace‑objekt och rätt repo är valt; använd Uppdatera; kontrollera token‑rättigheter.
- Inskick misslyckas med urlTooLong
  - Åtgärd: Minska parametrarnas storlek (t.ex. färre fält eller gå över till streaming/uppladdning); förvänta att inskick fungerar efter minskning.
- Streaming returnerar blob med fel innehållstyp
  - Åtgärd: Nedladdning finns ändå; verifiera att nedladdad fil öppnas; om fel, inspektera serverns workspace‑utdata.

## Genomförandelogg (sign‑off)

Använd denna tabell för sign‑off per avsnitt:

| Avsnitt               | Testare | Datum | Resultat | Bevislänk |
| --------------------- | ------- | ----- | -------- | --------- |
| Builder‑inställningar |         |       |          |           |
| Startkontroll         |         |       |          |           |
| Ritning & geometri    |         |       |          |           |
| Val av workspace      |         |       |          |           |
| Exportformulär        |         |       |          |           |
| Fjärrdataset          |         |       |          |           |
| Inskick (download)    |         |       |          |           |
| Inskick (stream)      |         |       |          |           |
| Orderresultat         |         |       |          |           |
| Säkerhet/loggning     |         |       |          |           |
| Tillgänglighet        |         |       |          |           |
| Flera instanser       |         |       |          |           |
| I18n                  |         |       |          |           |

## Noteringar och begränsningar

- ArcGIS JS API måste vara 4.29; inga direkta `@arcgis/core`‑imports i runtime (lazyladdas via loaders). Om moduler inte kan laddas visar start en modul‑error med försök igen.
- Alla FME‑anrop går via `FmeFlowApiClient`. Webhook‑GET och Streaming‑POST är de enda direkta hämtningarna enligt design; de inkluderar `token` som query‑parameter (maskas i loggar). REST v3 anrop injicerar `fmetoken` via interceptor och Authorization‑header.
- Klistra inte in riktiga hemligheter i skärmdumpar eller loggar. Maskera alltid som ****1234 vid dokumentation.
- Planen utgår från att en enda Kart‑widget är konfigurerad. Om ingen är konfigurerad leder startvyn till att åtgärda kartkonfigurationen.
- URL‑längd: Klienten respekterar `esriConfig.request.maxUrlLength` (lägst 4000). Webhook‑URL:er som överskrider gränsen avbryts med felet `URL_TOO_LONG` och visas som lokaliserat “URL:en är för lång”.

Ordbok/terminologi:

- Använd konsekvent “Kartritning” (inte “Kart­ritning”).
