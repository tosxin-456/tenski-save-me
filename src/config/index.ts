import * as dotenv from "dotenv";
dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || "4000", 10),
  nodeEnv: process.env.NODE_ENV || "development",
  isDev: process.env.NODE_ENV !== "production",

  db: {
    url: process.env.DATABASE_URL!,
  },

  jwt: {
    secret: process.env.JWT_SECRET || "change-this-secret-in-production",
    expiresIn: process.env.JWT_EXPIRES_IN || "7d",
  },

  frontend: {
    url: process.env.FRONTEND_URL || "http://localhost:3000",
  },

  upload: {
    maxFileSizeMb: parseInt(process.env.MAX_FILE_SIZE_MB || "50", 10),
    uploadDir: process.env.UPLOAD_DIR || "./uploads",
    allowedMimeTypes: [
      "application/pdf",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.ms-excel",
      "text/csv",
      "image/jpeg",
      "image/jpg",
      "image/png",
    ],
    allowedExtensions: [".pdf", ".xlsx", ".xls", ".csv", ".jpg", ".jpeg", ".png"],
  },

  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || "900000", 10),
    max: parseInt(process.env.RATE_LIMIT_MAX || "100", 10),
  },

  encryption: {
    key: process.env.ENCRYPTION_KEY || "32-char-encryption-key-placeholder",
  },
};
