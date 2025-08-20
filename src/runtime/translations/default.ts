export default {
  // General UI labels
  errorTitle: "Fel uppstod...",
  retry: "Försök igen",
  back: "Tillbaka",
  cancel: "Avbryt",

  // Startup validation messages
  validatingStartup: "Validerar konfiguration...",
  validatingConnection: "Testar anslutning till FME Server...",
  validatingAuthentication: "Validerar autentisering...",
  validatingConfiguration: "Kontrollerar konfiguration...",
  startupValidationFailed: "Fel vid validering av konfiguration",
  invalidConfiguration: "Widget-konfiguration saknas eller är ogiltig",
  connectionFailed: "Kunde inte ansluta till FME Server",
  authenticationFailed:
    "Ogiltig API-nyckel. Kontrollera att du har angett rätt FME API-nyckel.",
  contactSupport: "Kontakta support för hjälp med konfigurationen",
  contactSupportWithEmail: "Kontakta {email} för hjälp med konfigurationen",
  retryValidation: "Försök igen",

  // Loading messages used specifically in widget.tsx
  preparingExportRequest: "Förbereder exportförfrågan...",
  connectingToFmeServer: "Ansluter till FME Server...",
  submittingOrder: "Skickar beställning...",
  preparingMapTools: "Förbereder kartverktyg...",
  loadingMapServices: "Laddar karttjänster...",

  // Drawing instructions used in widget.tsx
  rectangleDrawingInstructions:
    "Klicka och dra för att skapa ett rektangulärt område",
  polygonDrawingStart: "Klicka för att börja rita ett område",
  polygonDrawingContinue: "Klicka för att fortsätta rita området",
  polygonDrawingComplete:
    "Klicka för att lägga till fler punkter eller dubbelklicka för att slutföra",
  drawInstruction: "Rita ett område på kartan",

  // Order status used in widget.tsx
  orderSubmitted: "Beställning skickad!",
  orderFailed: "Beställningen misslyckades",

  // Geometry / validation errors
  geometryMissing: "Geometri saknas",
  geometryTypeInvalid: "Endast polygongeometri stöds",
  polygonNoRings: "Polygon saknar ringar",
  polygonMinVertices: "Polygon kräver minst 3 hörn",
  polygonSelfIntersect: "Polygonen är självskärande",
  areaTooLarge: "Området överstiger tillåten maxstorlek",

  // Generic unexpected / processing
  unexpectedResponse: "Oväntat svar från FME-servern",
  jobSubmissionFailed: "FME-jobbsubmitering misslyckades",
  mapInitFailed: "Misslyckades att initiera kartan",
  drawingCompleteFailed: "Misslyckades att avsluta ritning",
}
