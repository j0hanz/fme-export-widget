export default {
  fmeServerUrl: "FME‑server‑URL",
  fmeServerToken: "API‑nyckel",
  fmeRepository: "Repository",
  missingToken: "Ange API‑nyckeln.",
  tokenWithWhitespace: "API‑nyckeln får inte innehålla blanksteg.",
  missingRepository: "Välj ett repository.",
  invalidRepository: "Det valda repositoryt finns inte i listan.",
  invalid_url: "Ogiltig URL.",
  require_https: "Endast HTTPS‑adresser stöds.",
  disallow_fmerest_for_webhook:
    "Ange bas‑URL utan /fmerest när du konfigurerar webhooks.",
  scheduleInvalid: "Kontrollera schemaläggningens starttid, namn och kategori.",
  errorTokenIssue: "API‑nyckeln saknas eller är ogiltig.",
  testConnection: "Kör anslutningstest",
  testing: "Testar anslutning…",
  testingConnection: "Testar…",
  loadingRepositories: "Hämtar repositories…",
  refreshRepositories: "Uppdatera listan",
  fmeVersion: "FME‑version",
  connectionOk: "Anslutningen lyckades.",
  connectionOkRepositoryWarning:
    "Anslutningen lyckades men repositoryt kunde inte verifieras. Kontrollera FME-behörigheterna.",
  connectionFailed: "Anslutningen misslyckades:",
  availableRepositories: "Tillgängliga repositories",
  mapConfiguration: "Kartinställningar",
  serverUrlPlaceholder: "https://fme.server.com",
  tokenPlaceholder: "Din API‑nyckel",
  repoPlaceholder: "Välj ett repository",
  noRepositoriesFound: "Inga repositories hittades",
  testConnectionFirst: "Testa anslutningen först",
  invalidEmail: "Ogiltig e‑postadress.",
  errorRepositories: "Det gick inte att hämta repositories.",
  errorInvalidServerUrl: "Ogiltig URL.",
  errorTokenIsInvalid: "Ogiltig API‑nyckel.",
  errorRepositoryNotFound: "Det valda repositoryt finns inte i listan.",
  repositoryNotAccessible:
    "Repositoryt kunde inte verifieras med den här API-nyckeln. Kontrollera behörigheter eller välj ett annat repository.",
  fixErrorsAbove: "Åtgärda felen ovan.",
  requiredField: "Obligatoriskt fält",
  ariaRequired: "Obligatoriskt fält",
  supportEmail: "Support‑e‑postadress",
  supportEmailPlaceholder: "support@exempel.se",
  tm_ttcLabel: "Max körtid (s)",
  tm_ttlLabel: "Max kötid (s)",
  tm_ttcPlaceholder: "Lämna tomt (0 s)",
  tm_ttlPlaceholder: "Lämna tomt (0 s)",
  serviceModeSync: "Direktnedladdning (synkront)",
  serviceModeSyncHelper:
    "På: nedladdning via direktlänk i webbläsaren. Av: länk skickas med e‑post.",
  maskEmailOnSuccess: "Maskera e‑postadress",
  maskEmailOnSuccessHelper:
    "Döljer större delen av e‑postadressen i lyckade svar (visar endast början och domänen).",
  showResultLabel: "Visa resultat i svaret",
  showResultHelper:
    "Styr FME‑parametern opt_showresult. Av: svaren innehåller endast jobbinformation utan transformationsresultat.",
  supportEmailHelper:
    "Om en adress anges visas den i felmeddelanden som supportkontakt.",
  requestTimeoutLabel: "Tidsgräns för begäran (ms)",
  requestTimeoutPlaceholder: "30000",
  requestTimeoutHelper:
    "Maximal väntetid på serversvar i millisekunder. Standard: 30000 (30 sekunder). Lämna tomt för ingen tidsgräns.",
  maxAreaLabel: "Max AOI‑yta (m²)",
  maxAreaHelper:
    "Lämna tomt för att tillåta obegränsad AOI‑yta. Högsta tillåtna värde: {maxM2} m².",
  maxAreaPlaceholder: "t.ex. 100000000",
  errorMaxAreaTooLarge: "Värdet är för stort.",
  largeAreaLabel: "Hög AOI‑yta (m²)",
  largeAreaHelper:
    "Visa en varning när ritad AOI överstiger detta värde. Lämna tomt för att inaktivera varningen. Högsta tillåtna värde: {maxM2} m².",
  largeAreaPlaceholder: "t.ex. 50000",
  largeAreaExceedsMaxInfo:
    "Varningsgränsen {largeM2} m² bör vara lägre än maxgränsen {maxM2} m².",
  ok: "OK",
  failed: "Misslyckades",
  skipped: "Välj repository",
  checking: "Kontrollerar …",
  error: "Fel",
  colon: ":",
  aoiParamNameLabel: "AOI‑parameternamn",
  aoiParamNamePlaceholder: "AreaOfInterest",
  aoiParamNameHelper:
    "Publicerat parameternamn för AOI. Standardvärde: AreaOfInterest.",
  allowScheduleModeLabel: "Tillåt schemaläggning",
  allowScheduleModeHelper: "Tillåt engångskörning vid en schemalagd tidpunkt.",
  allowRemoteDatasetLabel: "Tillåt filuppladdning (TEMP)",
  allowRemoteDatasetHelper:
    "Tillåt att användaren laddar upp en fil direkt till FME Flows TEMP‑resurs som indata.",
  allowRemoteUrlDatasetLabel: "Tillåt fjärr‑URL (HTTPS)",
  allowRemoteUrlDatasetHelper:
    "Tillåt att användaren anger en säker (HTTPS) URL som indata.",
  autoCloseOtherWidgetsLabel: "Stäng andra widgets automatiskt",
  autoCloseOtherWidgetsHelper:
    "Stäng andra widgets när FME‑exporten öppnas eller återställs för att hålla kartan ren.",
  drawingColorLabel: "Ritningsfärg",
  // Helpers for individual job directive fields (give clear FME Flow context)
  tm_ttcHelper:
    "Maximal körtid innan jobbet avbryts. Lämna tomt för att använda serverns standard.",
  tm_ttlHelper:
    "Maximal kötid innan jobbet tas bort eller markeras som misslyckat. Lämna tomt för att använda serverns standard.",
}
