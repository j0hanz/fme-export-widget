export default {
  errorTitle: "Något gick fel",
  back: "Tillbaka",
  submit: "Beställ",
  cancel: "Avbryt",
  continue: "Fortsätt",
  ok: "OK",
  retry: "Försök igen",
  specifyExtent: "Ange utbredning",

  // Order status and results used in content.tsx
  orderConfirmation: "Beställning bekräftad",
  orderSentError: "Beställningen misslyckades",
  jobId: "Jobb-ID",
  workspace: "Arbetsyta",
  notificationEmail: "E-postmeddelande",
  downloadResult: "Ladda ner resultat",
  emailNotificationSent: "Ett e-postmeddelande skickas när exporten är klar",
  reuseGeography: "Ny beställning",
  errorCode: "Felkod",
  orderResultMissing: "Inget tillgängligt",

  // Loading and status messages
  submittingOrder: "Skickar beställning...",
  preparingMapTools: "Förbereder kartverktyg...",
  loadingWorkspaces: "Laddar arbetsytor...",
  loadingWorkspaceDetails: "Laddar arbetsytedetaljer...",

  // Drawing mode related
  drawingModeTooltip: "Välj ritläge för att definiera området",
  drawingModePolygonTooltip: "Rita polygon",
  drawingModeRectangleTooltip: "Rita rektangel",

  // Tooltips used in ui.tsx and content.tsx
  tooltipBackToOptions: "Återgå till exportalternativ",
  tooltipSubmitOrder: "Skicka beställning för bearbetning",
  tooltipSpecifyExtent: "Klicka för att ange utbredning",
  tooltipCancel: "Avbryt nuvarande åtgärd och börja om",
  tooltipReuseGeography: "Skapa ny beställning med samma geografi",

  // Widget actions
  widgetActions: "Widget-åtgärder",

  // Error messages used in content.tsx
  failedToLoadWorkspaces: "Misslyckades med att ladda arbetsytor",
  failedToLoadWorkspaceDetails: "Misslyckades med att ladda arbetsytedetaljer",
  unknownErrorOccurred: "Ett okänt fel inträffade",
  noWorkspacesFound: "Inga arbetsytor hittades i detta repository",

  // Form validation used in ui.tsx and exports.tsx
  requiredField: "Detta fält är obligatoriskt.",
  formValidationSingleError: "Vänligen fyll i det obligatoriska fältet.",
  formValidationMultipleErrors: "Vänligen fyll i alla obligatoriska fält.",

  // Error handling used in exports.tsx
  configurationError: "Konfigurationsfel",
  missingExportConfiguration: "Saknar exportkonfiguration",
  exportFormRequiresConfiguration:
    "Exportformulär kräver antingen arbetsyteparametrar eller exportvariant.",

  // Dynamic form placeholders
  placeholderSelect: "Välj {field}...",
  placeholderEnter: "Ange {field}...",
  reuseGeometry: "Återanvänd geometri",
  download: "Ladda ner",
  // Generic placeholders and a11y labels used in ui.tsx
  placeholderSelectGeneric: "Välj ett alternativ",
  ariaButtonLabel: "Knapp",
  ariaLoadingDetails: "Laddningsdetaljer",
  ariaErrorActions: "Felåtgärder",
  ariaEmptyActions: "Tomt läge åtgärder",
  ariaSuccessActions: "Lyckade åtgärder",
  ariaRequired: "Obligatoriskt",
}
