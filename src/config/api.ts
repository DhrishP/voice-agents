import dotenv from "dotenv";

dotenv.config();

export const apiConfig = {
  port: parseInt(process.env.PORT || "3000"),
};
