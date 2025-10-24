# FME Export-widget

Exportera ett *Area of Interest* (AOI) från en karta i ArcGIS Experience Builder till FME Flow (Server). Användaren gör en utbredning genom att rita en polygon eller rektangel på specifik yta, väljer FME-arbetsflöde, fyller i parametrar och skickar ett exportjobb.

> 📝 **Dokumentation**: Publiceras vid lansering.

## FME Flow API Version

Widgeten adresserar FME Flow REST API V4 via baskontexten `/fmeapiv4`. Äldre miljöer kan byggas mot V3 genom att justera `FME_FLOW_API.BASE_PATH` i `src/config/constants.ts` före bygge.

## Presentation

* 📄 **FME Användarträff 2025**
  [Öppna PDF](https://github.com/user-attachments/files/23019353/FMEAnvandartraff2025.pdf)
