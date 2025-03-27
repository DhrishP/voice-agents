export const plivoConfig = {
  port: parseInt(process.env.PLIVO_PORT || "5001"),
  authId: process.env.PLIVO_AUTH_ID,
  authToken: process.env.PLIVO_AUTH_TOKEN,
};
