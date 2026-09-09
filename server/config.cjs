// Centralized server configuration
const path = require("path");
require("dotenv").config();

const ROOT_DIR = path.resolve(__dirname, "..");
const PORT = Number(process.env.PORT || 3002);
const LLM_URL = process.env.LLM_URL || "http://127.0.0.1:8317/v1/chat/completions";
const MODEL_ID = process.env.MODEL_ID || "gemini-3.8-flash-medium";
const MODEL_QA = process.env.MODEL_QA || "gemini-3.8-flash-medium";
const APP_KEY = (process.env.APP_KEY || "").trim();
const ADMIN_KEY = (process.env.ADMIN_KEY || "").trim();
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const TRUST_LOOPBACK = process.env.TRUST_LOOPBACK === "1";
const RATE_PER_HOUR = Number(process.env.RATE_MAX_PER_HOUR || 120);
const RATE_PER_DAY = Number(process.env.RATE_MAX_PER_DAY || 800);
const FEEDBACK_MAX_PER_HOUR = Number(process.env.FEEDBACK_MAX_PER_HOUR || 60);

const KB_PATH = process.env.KB_PATH || path.join(ROOT_DIR, "data", "hainbuch_products.json");
const IMG_PATH = process.env.IMG_PATH || path.join(ROOT_DIR, "hainbuch-images.json");
const SHOP_DIR = process.env.SHOP_DIR || path.join(ROOT_DIR, "catalog", "shop");
const SHOP_JSON = process.env.SHOP_JSON || path.join(ROOT_DIR, "catalog", "shop_accessories.json");
const CATALOG_JSON = process.env.CATALOG_JSON || path.join(ROOT_DIR, "catalog", "products_de.json");
const MAP_JSON = process.env.MAP_JSON || path.join(ROOT_DIR, "catalog", "map.json");
const HERO_DIR = path.join(ROOT_DIR, "catalog");
const DIST_DIR = path.join(ROOT_DIR, "dist");

module.exports = {
  ROOT_DIR,
  PORT,
  LLM_URL,
  MODEL_ID,
  MODEL_QA,
  APP_KEY,
  ADMIN_KEY,
  BASE_URL,
  TRUST_LOOPBACK,
  RATE_PER_HOUR,
  RATE_PER_DAY,
  FEEDBACK_MAX_PER_HOUR,
  KB_PATH,
  IMG_PATH,
  SHOP_DIR,
  SHOP_JSON,
  CATALOG_JSON,
  MAP_JSON,
  HERO_DIR,
  DIST_DIR,
};
