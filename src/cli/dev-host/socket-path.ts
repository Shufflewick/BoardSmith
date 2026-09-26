/**
 * The path `boardsmith dev` serves its table socket on. The page
 * (`DevHost.vue`), the server (`claimDevHostSocket`) and a scripted client's
 * URL all name this one constant, so none can drift from the others (#422).
 */
export const DEV_HOST_WS_PATH = '/__boardsmith/ws';
