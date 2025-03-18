export const websocketConfig = {
  port: process.env.WEBSOCKET_PORT
    ? parseInt(process.env.WEBSOCKET_PORT)
    : 5004,
};
