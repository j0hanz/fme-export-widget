export default {
  back: "Tillbaka",
  submit: "Beställ",
  cancel: "Avbryt",
  ok: "OK",
  retry: "Försök igen",

  // Order status and results used in content.tsx
  orderConfirmation: "Beställningen är bekräftad",
  orderSentError: "Beställningen misslyckades",
  jobId: "Jobb-ID",
  workspace: "Arbetsyta",
  notificationEmail: "E‑post",
  emailNotificationSent:
    "När beställningen är klar skickas ett e‑postmeddelande till den här adressen.",
  downloadReady: "Nedladdning klar:",
  clickToDownload: "Ladda ner filen",
  reuseGeography: "Ny beställning",
  errorCode: "Felkod",
  orderResultMissing: "Inget tillgängligt",

  // Loading and status messages
  submittingOrder: "Skickar beställningen...",
  submittingOrderSync: "Bearbetar beställningen... Detta kan ta flera minuter.",
  preparingMapTools: "Förbereder kartverktygen...",
  loadingWorkspaces: "Laddar arbetsytor...",
  loadingWorkspaceDetails: "Laddar information om arbetsytan...",

  // Drawing mode related
  drawingModeTooltip: "Välj ritläge för att definiera området",

  // Tooltips used in ui.tsx and content.tsx
  tooltipBackToOptions: "Återgå till exportalternativ",
  tooltipSubmitOrder: "Skicka beställningen för bearbetning",
  tooltipCancel: "Avbryt nuvarande åtgärd och börja om",
  tooltipReuseGeography: "Skapa ny beställning med samma geografi",

  // Order result specific localized failure text
  fmeFlowTransformationFailed:
    "FME Flow-transformationen misslyckades. Kontrollera loggfilen ovan för detaljer.",

  // Error messages used in content.tsx
  failedToLoadWorkspaces: "Det gick inte att ladda arbetsytor",
  failedToLoadWorkspaceDetails:
    "Det gick inte att ladda information om arbetsytan",
  unknownErrorOccurred: "Ett okänt fel inträffade",
  noWorkspacesFound: "Inga arbetsytor hittades i detta repository",

  // Form validation used in ui.tsx and exports.tsx
  requiredField: "Detta fält är obligatoriskt.",
  formValidationSingleError: "Vänligen fyll i det obligatoriska fältet.",
  formValidationMultipleErrors: "Vänligen fyll i alla obligatoriska fält.",

  // Error handling used in exports.tsx
  missingExportConfiguration: "Saknar exportkonfiguration",

  // Dynamic form placeholders
  placeholderSelect: "{field}...",
  placeholderEnter: "{field}...",

  // Generic placeholders and a11y labels used in ui.tsx
  placeholderSelectGeneric: "Välj ett alternativ",
  ariaButtonLabel: "Knapp",
  ariaLoadingDetails: "Laddningsdetaljer",
  ariaErrorActions: "Felåtgärder",
  ariaEmptyActions: "Tomt läge åtgärder",
  ariaSuccessActions: "Lyckade åtgärder",
  ariaRequired: "Obligatoriskt",
}
