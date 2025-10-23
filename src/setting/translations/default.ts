export default {
  // === LABELS ===
  lblServerUrl: "FME‑server‑URL",
  lblApiToken: "API‑nyckel",
  lblRepository: "Repository",
  lblRepositories: "Tillgängliga repositorys",
  lblFmeVersion: "FME‑version",
  lblServiceMode: "Leveransläge",
  lblMaskEmail: "Maskera e‑postadress",
  lblShowResult: "Visa resultat i svaret",
  lblAllowUpload: "Tillåt filuppladdning (TEMP)",
  lblAllowUrl: "Tillåt fjärr‑URL (HTTPS)",
  lblUploadParam: "Upload‑målparameter",
  lblMaxArea: "Max AOI‑yta (m²)",
  lblLargeArea: "Rekommenderad AOI‑yta (m²)",
  lblTimeCompute: "Max körtid (s)",
  lblTimeQueue: "Max kötid (s)",
  lblRequestTimeout: "Tidsgräns för begäran (ms)",
  lblAoiParam: "AOI‑parameternamn",
  lblRequireHttps: "Kräv HTTPS",
  lblAutoClose: "Stäng andra widgets automatiskt",
  lblDrawColor: "Ritningsfärg",
  lblSupportEmail: "Support‑e‑postadress",

  // === ERRORS ===
  errNoServerUrl: "Ange FME‑server‑URL.",
  errNoToken: "Ange API‑nyckeln.",
  errTokenSpaces: "API‑nyckeln får inte innehålla blanksteg.",
  errNoRepository: "Välj ett repository",
  errInvalidRepository: "Det valda repositoryt finns inte i listan.",
  errInvalidUrl: "Ogiltig URL.",
  errRequireHttps: "Endast HTTPS‑adresser stöds.",
  errNoFmerest: "Ange bas‑URL utan /fmerest när du konfigurerar webhooks.",
  errTokenInvalid: "API‑nyckeln saknas eller är ogiltig.",
  errLoadRepositories: "Kunde inte läsa repositorys.",
  errServerUrl: "Ogiltig URL.",
  errRepositoryMissing: "Det valda repositoryt finns inte i listan.",
  errRepositoryAccess:
    "Det valda repositoryt är inte åtkomligt. Kontrollera behörigheter.",
  errAreaTooLarge: "Värdet är för stort.",
  errUploadParamRequired: "Ange parameter för uppladdad fil.",
  errInvalidEmail: "Ogiltig e‑postadress.",

  // === BUTTONS ===
  btnTestConnection: "Kör anslutningstest",
  btnRefreshRepos: "Uppdatera listan",

  // === STATUS ===
  statusTesting: "Testar anslutning…",
  statusTestConnection: "Testar…",
  statusLoadRepos: "Läser repositorys…",
  statusValidateUrl: "Validerar server-URL…",
  statusValidateToken: "Kontrollerar API-nyckel…",
  statusOk: "OK",
  statusFailed: "Misslyckades",
  statusSkipped: "Ej utförd",
  statusChecking: "Kontrollerar…",
  statusError: "Fel",

  // === MESSAGES ===
  msgConnectionOk: "Anslutningen lyckades.",
  msgConnectionWarning:
    "Anslutningen lyckades men repositoryt kunde inte verifieras. Kontrollera behörigheter.",
  msgFixErrors: "Åtgärda felen ovan.",
  msgNoRepositories: "Inga repositorys hittades.",
  msgAreaExceeds:
    "Varningsgränsen {largeM2} m² bör vara lägre än maxgränsen {maxM2} m².",

  // === HINTS ===
  hintServiceMode:
    "Välj hur resultatet ska levereras: via e-post eller direkt i webbläsaren.",
  hintMaskEmail: "Döljer större delen av e‑postadressen i orderbekräftelsen.",
  hintShowResult:
    "Styr FME‑parametern opt_showresult. Av: svaren innehåller endast jobbinformation.",
  hintAllowUpload:
    "Tillåt användaren att ladda upp fil direkt till FME Flows TEMP‑resurs.",
  hintAllowUrl:
    "Tillåt användaren att ange säker (HTTPS) URL som indata. Kräver filuppladdning.",
  hintUploadParam:
    "FME‑parameter som tar emot uppladdad fils målsökväg. Krävs om filuppladdning är tillåten.",
  hintMaxArea:
    "Lämna tomt för obegränsad yta. Högsta tillåtna värde: {maxM2} m².",
  hintLargeArea:
    "Visa varning när ritad yta överstiger detta värde. Högsta värde: {maxM2} m².",
  hintTimeCompute:
    "Maximal körtid innan jobbet avbryts. Gäller endast i synkront läge. Lämna tomt för serverns standard.",
  hintTimeQueue:
    "Maximal kötid innan jobbet tas bort eller markeras som misslyckat. Lämna tomt för serverns standard.",
  hintRequestTimeout:
    "Maximal väntetid på serversvar i millisekunder. Standard: 30 sekunder.",
  hintAoiParam:
    "Publicerat parameternamn för området. Standard: AreaOfInterest.",
  hintRequireHttps:
    "På: Tillåt endast HTTPS för FME‑server‑URL. Av: Tillåt både HTTP och HTTPS.",
  hintAutoClose:
    "Stäng andra widgets när FME‑exporten öppnas för att hålla kartan ren.",
  hintSupportEmail:
    "Om en adress anges visas den i felmeddelanden som supportkontakt.",
  hintTestFirst: "Testa anslutningen först",

  // === PLACEHOLDERS ===
  phServerUrl: "https://fme.server.com",
  phApiToken: "Din API‑nyckel",
  phRepository: "Välj ett repository",
  phEmail: "support@exempel.se",
  phMaxArea: "t.ex. 100000000",
  phLargeArea: "t.ex. 50000",
  phTimeCompute: "Lämna tomt (standard)",
  phTimeQueue: "Lämna tomt (standard)",
  phRequestTimeout: "30000",
  phAoiParam: "AreaOfInterest",
  phUploadParam: "t.ex. DEST_DATASET",

  // === OPTIONS ===
  optAsync: "E-postmeddelande (async)",
  optSync: "Direkt nerladdning (sync)",

  // === VALIDATION ===
  valRequiredField: "Obligatoriskt fält",

  // === ARIA ===
  ariaRequired: "Obligatoriskt fält",

  // === UI ===
  uiColon: ":",

  // === TITLES ===
  titleMapConfig: "Kartinställningar",
}
