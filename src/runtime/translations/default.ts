export default {
  retry: "Försök igen",
  back: "Tillbaka",
  cancel: "Avbryt",
  unknownErrorOccurred: "Ett okänt fel inträffade",
  reload: "Ladda om",

  // Startup validation messages
  validatingStartup: "Validerar konfiguration...",
  validatingMapConfiguration: "Kontrollerar kartkonfiguration...",
  validatingConnection: "Testar anslutningen till FME Server...",
  validatingAuthentication: "Validerar autentisering...",
  validatingUserEmail: "Kontrollerar användarens e‑postadress...",
  validatingConfiguration: "Kontrollerar konfigurationen...",
  startupValidationFailed: "Konfigurationsfel uppstod",
  invalidConfiguration: "Widgetens konfiguration saknas eller är ogiltig",
  serverUrlMissing: "FME Server-URL saknas",
  tokenMissing: "FME API-nyckel saknas",
  repositoryMissing: "Repository saknas",
  connectionFailed: "Det gick inte att ansluta till FME Server",
  authenticationFailed:
    "Ogiltig API-nyckel. Kontrollera att du har angett rätt FME API-nyckel.",
  // Short error messages for specific startup errors
  repoNotFound: "Repository hittades inte",
  serverError: "Serverfel",
  networkError: "Nätverksfel",
  timeout: "Tidsgräns överskreds",
  badResponse: "Ogiltigt serversvar",
  contactSupport: "Kontakta supporten för hjälp med konfigurationen",
  contactSupportWithEmail: "Kontakta {email} för hjälp med konfigurationen",
  retryValidation: "Försök igen",
  requestAborted: "Åtgärden avbröts",
  operationCancelled: "Åtgärden har avbrutits",
  corsError: "Blockerad av CORS-policy",
  offline: "Ingen internetanslutning",
  sslError: "SSL/TLS‑fel",
  invalidUrl: "Ogiltig URL",
  rateLimited: "För många förfrågningar (rate limit)",
  badGateway: "Felaktig gateway",
  serviceUnavailable: "Tjänsten otillgänglig",
  gatewayTimeout: "Gateway‑timeout",
  badRequest: "Ogiltig begäran",
  payloadTooLarge: "För stor begäran",
  invalidEmail: "Ogiltig e‑post",

  // Loading messages used specifically in widget.tsx
  submittingOrder: "Skickar beställningen...",
  preparingMapTools: "Förbereder kartverktygen...",
  loadingMapServices: "Laddar karttjänster...",

  // Drawing instructions used in widget.tsx
  rectangleDrawingInstructions:
    "Markera området på kartan och klicka för att slutföra",
  polygonDrawingStart: "Klicka för att börja rita ett område",
  polygonDrawingContinue: "Klicka för att fortsätta rita området",
  polygonDrawingComplete:
    "Klicka för att lägga till fler punkter eller dubbelklicka för att slutföra",
  drawInstruction: "Rita ett område på kartan",

  // Order status used in widget.tsx
  orderFailed: "Beställningen misslyckades",

  // FME response messages
  unexpectedFmeResponse: "Oväntat svar från FME Server",
  exportOrderSubmitted: "Exportbeställningen har skickats",
  fmeJobSubmissionFailed: "Det gick inte att skicka FME‑jobbet",

  // Generic unexpected / processing
  mapInitFailed: "Misslyckades att initiera kartan",
  drawingCompleteFailed: "Misslyckades att avsluta ritning",

  // Graphic popup template labels
  drawnAreaTitle: "Ritat område",
  exportJobTitle: "Exportjobb",
  areaLabel: "Område",
  vertexCountLabel: "Antal punkter",
  geometryTypeLabel: "Geometrityp",
  exportStatusLabel: "Exportstatus",
  workspaceLabel: "Arbetsyta",
  jobIdLabel: "Jobb-ID",
  submissionTimeLabel: "Skickat",

  // Map configuration validation
  mapNotConfigured: "Ingen karta är konfigurerad",

  // User email validation
  userEmailMissing:
    "Användarens e-postadress krävs för att använda denna funktion",

  // Workspace loading errors
  failedToLoadWorkspaces: "Det gick inte att ladda tillgängliga arbetsytor",
  failedToLoadWorkspaceDetails:
    "Det gick inte att ladda detaljer för vald arbetsyta",
}
