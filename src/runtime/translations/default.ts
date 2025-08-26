export default {
  // General UI labels
  errorTitle: "Ett fel uppstod",
  retry: "Försök igen",
  back: "Tillbaka",
  cancel: "Avbryt",
  unknownErrorOccurred: "Ett okänt fel inträffade",

  // Startup validation messages
  validatingStartup: "Validerar konfiguration...",
  validatingMapConfiguration: "Kontrollerar kartkonfiguration...",
  validatingConnection: "Testar anslutningen till FME Server...",
  validatingAuthentication: "Validerar autentisering...",
  validatingUserEmail: "Kontrollerar användarens e‑postadress...",
  validatingConfiguration: "Kontrollerar konfigurationen...",
  startupValidationFailed: "Konfigurationsfel uppstod",
  invalidConfiguration: "Widgetens konfiguration saknas eller är ogiltig",
  connectionFailed: "Det gick inte att ansluta till FME Server",
  authenticationFailed:
    "Ogiltig API-nyckel. Kontrollera att du har angett rätt FME API-nyckel.",
  userEmailMissing:
    "Ingen e‑postadress hittades för din användare. Kontakta support eller uppdatera din profil.",
  contactSupport: "Kontakta supporten för hjälp med konfigurationen",
  contactSupportWithEmail: "Kontakta {email} för hjälp med konfigurationen",
  retryValidation: "Försök igen",

  // Loading messages used specifically in widget.tsx
  preparingExportRequest: "Förbereder exportförfrågan...",
  connectingToFmeServer: "Ansluter till FME Server...",
  submittingOrder: "Skickar beställningen...",
  preparingMapTools: "Förbereder kartverktygen...",
  loadingMapServices: "Laddar karttjänster...",

  // Map configuration errors
  mapNotConfigured: "Ingen karta har konfigurerats",

  // Drawing instructions used in widget.tsx
  rectangleDrawingInstructions:
    "Markera området på kartan och klicka för att slutföra",
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
  jobSubmissionFailed: "Det gick inte att skapa FME‑jobbet",
  mapInitFailed: "Misslyckades att initiera kartan",
  drawingCompleteFailed: "Misslyckades att avsluta ritning",
}
