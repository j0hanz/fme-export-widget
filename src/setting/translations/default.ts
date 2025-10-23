export default {
  lblServerUrl: "FME Flow server-URL",
  lblApiToken: "API-token",
  lblRepository: "Repository",
  lblRepositories: "Tillgängliga repositories",
  lblFmeVersion: "FME Flow-version",
  lblServiceMode: "Leveransmetod",
  lblMaskEmail: "Maskera e-postadress",
  lblShowResult: "Inkludera resultat i svar",
  lblAllowUpload: "Tillåt filuppladdning (TEMP)",
  lblAllowUrl: "Tillåt fjärr-URL (HTTPS)",
  lblUploadParam: "Uppladdningsparameter",
  lblMaxArea: "Maximal exportyta (m²)",
  lblLargeArea: "Varningsgräns för yta (m²)",
  lblTimeCompute: "Maximal körtid (sekunder)",
  lblTimeQueue: "Maximal kötid (sekunder)",
  lblRequestTimeout: "Timeout för förfrågan (ms)",
  lblAoiParam: "Parameternamn för område",
  lblRequireHttps: "Kräv HTTPS",
  lblAutoClose: "Stäng andra widgets automatiskt",
  lblDrawColor: "Färg för ritverktyg",
  lblSupportEmail: "Supportkontakt",
  errNoServerUrl: "FME Flow server-URL krävs",
  errNoToken: "API-token krävs",
  errTokenSpaces: "API-token får inte innehålla mellanslag",
  errNoRepository: "Repository måste väljas",
  errInvalidRepository: "Det valda repositoryt finns inte i listan",
  errInvalidUrl: "Ogiltigt URL-format",
  errRequireHttps: "Endast HTTPS-adresser tillåts",
  errNoFmerest: "Ange bas-URL utan /fmerest för webhook-konfiguration",
  errTokenInvalid: "API-token är ogiltigt",
  errLoadRepositories: "Kunde inte hämta repositories från FME Flow",
  errServerUrl: "Ogiltig URL",
  errRepositoryMissing: "Det valda repositoryt finns inte längre",
  errRepositoryAccess:
    "Repository är inte tillgängligt med aktuellt API-token. Kontrollera behörigheter",
  errAreaTooLarge: "Värdet överskrider maxgränsen",
  errUploadParamRequired:
    "Uppladdningsparameter krävs när filuppladdning är aktiverad",
  errInvalidEmail: "Ogiltig e-postadress",
  /* Nya valideringsnycklar för konsekvent felmappning */
  errorInvalidServerUrl: "Ogiltig server-URL",
  errorTokenIsInvalid: "API-token är ogiltigt",
  errorRepositoryNotFound: "Det valda repositoryt finns inte",
  errorMaxAreaTooLarge: "Värdet överskrider maxgränsen ({maxM2} m²)",
  uploadTargetParamNameRequired:
    "Uppladdningsparameter krävs när filuppladdning är aktiverad",
  /* Kartlagda URL-valideringsnycklar från SERVER_URL_REASON_TO_KEY */
  require_https: "Endast HTTPS-adresser tillåts",
  invalid_url: "Ogiltigt URL-format",
  no_query_or_hash: "URL får inte innehålla frågetecken eller hash",
  disallow_fmerest_for_webhook:
    "Ange bas-URL utan /fmerest för webhook-konfiguration",
  /* Token- och repository-nycklar som returneras av delade validatorer */
  missingToken: "API-token krävs",
  tokenWithWhitespace: "API-token får inte innehålla mellanslag",
  errorTokenIssue: "API-token saknas eller är ogiltigt",
  missingRepository: "Repository måste väljas",
  invalidRepository: "Ogiltigt repository",
  /* E-postvalidering som används i buildern */
  invalidEmail: "Ogiltig e-postadress",
  emailRequired: "E-postadress krävs",
  btnTestConnection: "Testa anslutning",
  btnRefreshRepos: "Uppdatera repositories",
  statusTesting: "Testar anslutning till FME Flow…",
  statusTestConnection: "Testar…",
  statusLoadRepos: "Hämtar repositories…",
  statusValidateUrl: "Validerar server-URL…",
  statusValidateToken: "Verifierar API-token…",
  statusOk: "OK",
  statusFailed: "Misslyckades",
  statusSkipped: "Hoppades över",
  statusChecking: "Kontrollerar…",
  statusError: "Fel",
  msgConnectionOk: "Anslutningen till FME Flow lyckades",
  msgConnectionWarning:
    "Anslutningen lyckades men repositoryt kunde inte verifieras. Kontrollera API-token behörigheter",
  msgFixErrors: "Åtgärda felen ovan innan du fortsätter",
  msgNoRepositories: "Inga repositories hittades på FME Flow-servern",
  msgAreaExceeds:
    "Varningsgränsen ({largeM2} m²) bör vara lägre än maxgränsen ({maxM2} m²)",
  hintServiceMode:
    "Välj leveransmetod: Direkt nedladdning för mindre dataset eller e-postnotifiering för större exporter",
  hintMaskEmail:
    "Döljer delar av e-postadressen i exportbekräftelsen (t.ex. a***@example.com)",
  hintShowResult:
    "Styr FME-parametern opt_showresult. När avmarkerad innehåller svaret endast jobbinformation",
  hintAllowUpload:
    "Låter användare ladda upp datakällor direkt till FME Flows TEMP-resurs för bearbetning",
  hintAllowUrl:
    "Låter användare ange HTTPS-URL till fjärrdatakälla. Kräver att filuppladdning är aktiverad",
  hintUploadParam:
    "Workspace-parameter som ska ta emot sökvägen till den uppladdade filen. Krävs när filuppladdning är aktiverad",
  hintMaxArea:
    "Maximal tillåten yta för exportområdet. Lämna tomt för obegränsad yta. Högsta värde: {maxM2} m²",
  hintLargeArea:
    "Visa varning när det ritade området överstiger detta värde. Hjälper användare att undvika långsamma exporter. Max: {maxM2} m²",
  hintTimeCompute:
    "Maximal körtid för workspace innan FME Flow avbryter jobbet. Gäller endast direkt nedladdning. Lämna tomt för serverns standardvärde",
  hintTimeQueue:
    "Maximal kötid innan jobb tas bort från kön. Lämna tomt för serverns standardvärde",
  hintRequestTimeout:
    "Maximal väntetid på FME Flow-svar i millisekunder. Standard: 30000 ms (30 sekunder)",
  hintAoiParam:
    "Namnet på workspace-parametern som tar emot exportområdet. Standardvärde: AreaOfInterest",
  hintRequireHttps:
    "När aktiverad accepteras endast HTTPS-anslutningar till FME Flow. Inaktiverad tillåter både HTTP och HTTPS",
  hintAutoClose:
    "Stänger automatiskt andra widgets när FME Export öppnas för att minimera visuella störningar",
  hintSupportEmail:
    "Visas i felmeddelanden som kontaktväg för användare. Lämna tomt för att inte visa supportkontakt",
  hintTestFirst: "Testa anslutningen innan du fortsätter konfigurationen",
  tokenSettingsHint: "Verifiera API-token i inställningarna",
  serverUrlSettingsHint: "Kontrollera FME Flow server-URL i inställningarna",
  repositorySettingsHint: "Välj ett giltigt repository i inställningarna",
  connectionSettingsHint:
    "Kontrollera anslutningsinställningarna i konfigurationspanelen",
  networkConnectionHint:
    "Kontrollera nätverksanslutning och brandväggsinställningar",
  phServerUrl: "https://fmeflow.example.com",
  phApiToken: "fmetoken token=abc123...",
  phRepository: "Välj repository",
  phEmail: "support@foretag.se",
  phMaxArea: "100000000",
  phLargeArea: "50000000",
  phTimeCompute: "Använd serverns standardvärde",
  phTimeQueue: "Använd serverns standardvärde",
  phRequestTimeout: "30000",
  phAoiParam: "AreaOfInterest",
  phUploadParam: "DEST_DATASET",
  optAsync: "E-postnotifiering",
  optSync: "Direkt nedladdning",
  valRequiredField: "Obligatoriskt fält",
  ariaRequired: "Obligatoriskt fält",
  uiColon: ":",
  titleMapConfig: "Kartkonfiguration",
}
