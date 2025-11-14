# ISSUES that needs to be adressed and solved

1. **Invalid Token Error Handling**: When the FME token is invalid, the widget does not display the error state UI with the token error code. Instead, it renders the drawing mode with drawing tool buttons. Each specific error state must be shown to users to ensure proper feedback.

2. **Input Field Validation Debouncing**: The server URL and FME token input fields trigger API requests immediately on every keystroke. Implement a debounced delay (using `hooks.useEventCallback` with debouncing pattern) for validation requests to prevent excessive API calls during typing. This will reduce network overhead and improve performance.
