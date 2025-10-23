export default {
  lblServerUrl: "FME Flow server-URL",
  lblApiToken: "API-token",
  lblRepository: "Repository",
  lblRepositories: "Tillgängliga repositories",
  lblFmeVersion: "FME Flow-version",
  lblServiceMode: "Leveransmetod",
  lblMaskEmail: "Maskera e-postadress",
  lblShowResult: "Inkludera resultat i svar",
  lblAllowUpload: "Aktivera filuppladdning (TEMP)",
  lblAllowUrl: "Aktivera fjärr-URL (HTTPS)",
  lblUploadParam: "Upload-parameter",
  lblMaxArea: "Max exportområde (m²)",
  lblLargeArea: "Varningsgräns för område (m²)",
  lblTimeCompute: "Max körtid (sekunder)",
  lblTimeQueue: "Max kötid (sekunder)",
  lblRequestTimeout: "Timeout för förfrågan (ms)",
  lblAoiParam: "Område-parameternamn",
  lblRequireHttps: "Kräv HTTPS",
  lblAutoClose: "Stäng andra widgets automatiskt",
  lblDrawColor: "Färg för ritverktyg",
  lblSupportEmail: "Support-kontakt",
  errNoServerUrl: "FME Flow server-URL krävs",
  errNoToken: "API-token krävs",
  errTokenSpaces: "API-token får inte innehålla blanksteg",
  errNoRepository: "Repository måste väljas",
  errInvalidRepository: "Valt repository finns inte i listan",
  errInvalidUrl: "Ogiltig URL-format",
  errRequireHttps: "Endast HTTPS-adresser tillåts",
  errNoFmerest: "Ange bas-URL utan /fmerest för webhook-konfiguration",
  errTokenInvalid: "API-token är ogiltig",
  errLoadRepositories: "Kunde inte hämta repositories från FME Flow",
  errServerUrl: "Ogiltig URL",
  errRepositoryMissing: "Valt repository finns inte längre",
  errRepositoryAccess:
    "Repository är inte tillgängligt med denna API-token. Kontrollera behörigheter",
  errAreaTooLarge: "Värdet överskrider maxgräns",
  errUploadParamRequired:
    "Upload-parameter krävs när filuppladdning är aktiverad",
  errInvalidEmail: "Ogiltig e-postadress",
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
  msgConnectionOk: "Anslutning till FME Flow lyckades",
  msgConnectionWarning:
    "Anslutning lyckades men repository kunde inte verifieras. Kontrollera API-token behörigheter",
  msgFixErrors: "Åtgärda felen ovan innan du fortsätter",
  msgNoRepositories: "Inga repositories hittades på FME Flow-servern",
  msgAreaExceeds:
    "Varningsgränsen ({largeM2} m²) bör vara lägre än maxgränsen ({maxM2} m²)",
  hintServiceMode:
    "Välj leveransmetod: Direkt nedladdning för mindre dataset eller e-postnotifiering för större export",
  hintMaskEmail:
    "Döljer delar av e-postadressen i exportbekräftelsen (t.ex. a***@example.com)",
  hintShowResult:
    "Styr FME-parametern opt_showresult. När avmarkerad innehåller svaret endast jobbinformation",
  hintAllowUpload:
    "Låter användare ladda upp dataset direkt till FME Flows TEMP-resurs för bearbetning",
  hintAllowUrl:
    "Låter användare ange HTTPS-URL till fjärrdataset. Kräver att filuppladdning är aktiverad",
  hintUploadParam:
    "Workspace-parameter som ska ta emot sökvägen till uppladdad fil. Krävs när filuppladdning är aktiverad",
  hintMaxArea:
    "Maximal tillåten yta för exportområde. Lämna tomt för obegränsat. Högsta värde: {maxM2} m²",
  hintLargeArea:
    "Visa varning när ritat område överstiger detta värde. Hjälper användare att undvika långsamma export. Max: {maxM2} m²",
  hintTimeCompute:
    "Maximal workspace-körtid innan FME Flow avbryter jobbet. Gäller endast direkt nedladdning. Lämna tomt för serverns standardvärde",
  hintTimeQueue:
    "Maximal kötid innan jobb tas bort från kön. Lämna tomt för serverns standardvärde",
  hintRequestTimeout:
    "Maximal väntetid på FME Flow-svar i millisekunder. Standard: 30000 ms (30 sekunder)",
  hintAoiParam:
    "Namnet på workspace-parametern som tar emot exportområdet. Standardvärde: AreaOfInterest",
  hintRequireHttps:
    "När aktiverad accepteras endast HTTPS-anslutning till FME Flow. Inaktiverad tillåter både HTTP och HTTPS",
  hintAutoClose:
    "Stänger automatiskt andra widgets när FME Export öppnas för att minimera visuella störningar",
  hintSupportEmail:
    "Visas i felmeddelanden som kontaktväg för användare. Lämna tom för att inte visa support-kontakt",
  hintTestFirst: "Testa anslutningen innan du fortsätter konfigurationen",
  phServerUrl: "https://fmeflow.example.com",
  phApiToken: "fmetoken token=abc123...",
  phRepository: "Välj repository",
  phEmail: "support@foretag.se",
  phMaxArea: "100000000",
  phLargeArea: "50000000",
  phTimeCompute: "Använd serverns standard",
  phTimeQueue: "Använd serverns standard",
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
