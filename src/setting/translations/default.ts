export default {
  fmeServerUrl: "FME‑server‑URL",
  fmeServerToken: "API‑nyckel",
  fmeRepository: "Repository",
  connection: {
    missingServerUrl: "Ange FME‑server‑URL.",
    missingToken: "Ange API‑nyckeln.",
    tokenWithWhitespace: "API‑nyckeln får inte innehålla blanksteg.",
    missingRepository: "Välj ett repository.",
    invalidRepository: "Det valda repositoryt finns inte i listan.",
  },
  validations: {
    urlInvalid: "Ange en giltig FME‑server‑URL.",
  },
  errorTokenIssue: "API‑nyckeln saknas eller är ogiltig.",
  testConnection: "Uppdatera och testa anslutning",
  testing: "Testar anslutningen …",
  testingConnection: "Uppdaterar och testar …",
  loadingRepositories: "Uppdaterar listan …",
  refreshRepositories: "Uppdatera listan",
  fmeVersion: "FME‑version",
  connectionOk: "Anslutningen lyckades.",
  connectionFailed: "Anslutningen misslyckades:",
  availableRepositories: "Tillgängliga repositories",
  mapConfiguration: "Kartinställningar",
  serverUrlPlaceholder: "https://fme.server.com",
  tokenPlaceholder: "Din API‑nyckel",
  repoPlaceholder: "Välj ett repository",
  noRepositoriesFound: "Inga repositories hittades",
  testConnectionFirst: "Testa anslutningen först",
  errorMissingServerUrl: "Ange FME‑server‑URL.",
  errorBadBaseUrl: "Ange en giltig FME‑server‑URL.",
  errorMissingToken: "Ange API‑nyckeln.",
  invalidEmail: "Ogiltig e‑postadress.",
  errorRepositories: "Det gick inte att hämta repositories.",
  errorInvalidServerUrl: "Ange en giltig FME‑server‑URL.",
  errorTokenIsInvalid: "Ogiltig API‑nyckel.",
  errorRepositoryNotFound: "Det valda repositoryt finns inte i listan.",
  fixErrorsAbove: "Åtgärda felen ovan.",
  requiredField: "Obligatoriskt fält",
  ariaRequired: "Obligatoriskt fält",
  supportEmail: "Support‑e‑postadress",
  supportEmailPlaceholder: "support@exempel.se",
  tm_ttcLabel: "Max körtid (s)",
  tm_ttlLabel: "Max kötid (s)",
  tm_tagLabel: "Kötagg",
  tm_tagOptionNormal: "Normal",
  tm_tagOptionFast: "Snabb",
  tm_ttcPlaceholder: "Lämna tomt (0 s)",
  tm_ttlPlaceholder: "Lämna tomt (0 s)",
  tm_descriptionLabel: "Jobbeskrivning",
  tm_descriptionPlaceholder: "Kort beskrivning av körningen",
  tm_descriptionHelper:
    "Visas i FME Flow‑gränssnittet och i e‑postmeddelanden.",
  serviceModeSync: "Direktnedladdning (synkront)",
  serviceModeSyncHelper:
    "På: nedladdning via direktlänk i webbläsaren. Av: länk skickas med e‑post.",
  maskEmailOnSuccess: "Maskera e‑postadress",
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
  largeAreaMessageLabel: "Varningsmeddelande (stor AOI)",
  largeAreaMessageHelper:
    "Texten visas när ritad AOI överstiger varningsgränsen. Tillgängliga platshållare: {current} (ritad yta), {threshold} (varningsgräns). Lämna tomt för standardmeddelandet. Max {max} tecken.",
  largeAreaMessagePlaceholder: "Lämna tomt för standardmeddelandet.",
  largeAreaInfoMessageLabel: "Informationsmeddelande (stor AOI)",
  largeAreaInfoMessageHelper:
    "Texten visas under arbetsytorna när varningsikonen visas. Platshållare: {current} (ritad yta), {threshold} (varningsgräns). Lämna tomt för att återgå till standardmeddelandet.",
  largeAreaInfoMessagePlaceholder:
    "Valfri instruktion, t.ex. föreslå ett mindre område.",
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
  aoiGeoJsonParamNameLabel: "AOI‑GeoJSON‑parameternamn",
  aoiGeoJsonParamNamePlaceholder: "t.ex. ExtentGeoJson",
  aoiGeoJsonParamNameHelper:
    "Om angivet skickas AOI även som GeoJSON under detta parameternamn.",
  aoiWktParamNameLabel: "AOI‑WKT‑parameternamn",
  aoiWktParamNamePlaceholder: "t.ex. AreaOfInterestWKT",
  aoiWktParamNameHelper:
    "Om angivet skickas AOI även som WKT under detta parameternamn.",
  uploadTargetParamNameLabel: "Parameternamn för uppladdning",
  uploadTargetParamNamePlaceholder: "t.ex. INPUT_DATASET",
  uploadTargetParamNameHelper:
    "Om angivet skickas uppladdade filer under detta parameternamn.",
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
  serviceTypeLabel: "Tjänstetyp",
  serviceTypeDownload: "Download",
  serviceTypeStream: "Streaming",
  serviceTypeHelper:
    "Download: nedladdning av filer när jobbet är klart. Streaming: strömma data direkt från jobbet (om arbetsytan stöder det).",
  drawingColorLabel: "Ritningsfärg",
  // Helpers for individual job directive fields (give clear FME Flow context)
  tm_ttcHelper:
    "Maximal körtid innan jobbet avbryts. Lämna tomt för att använda serverns standard.",
  tm_ttlHelper:
    "Maximal kötid innan jobbet tas bort eller markeras som misslyckat. Lämna tomt för att använda serverns standard.",
  tm_tagHelper:
    "Anger vilken kö (publicerad parameter 'tm_tag') jobbet skickas till. Ange 'fast' för prioriterad kö när sådan finns på servern. Lämna tomt för att använda standardkö.",
}
