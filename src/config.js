'use strict';

const path = require('path');

const ROOT = path.join(__dirname, '..');

// Whitelisted Whisper models
const MODELS = ['large-v3', 'large', 'medium'];

// Whitelisted video languages: value passed to whisper --language, plus ISO code
const LANGUAGES = [
  { label: 'English',    value: 'English',    code: 'en' },
  { label: 'Ukrainian',  value: 'Ukrainian',  code: 'uk' },
  { label: 'Russian',    value: 'Russian',    code: 'ru' },
  { label: 'German',     value: 'German',     code: 'de' },
  { label: 'French',     value: 'French',     code: 'fr' },
  { label: 'Spanish',    value: 'Spanish',    code: 'es' },
  { label: 'Italian',    value: 'Italian',    code: 'it' },
  { label: 'Portuguese', value: 'Portuguese', code: 'pt' },
  { label: 'Polish',     value: 'Polish',     code: 'pl' },
  { label: 'Czech',      value: 'Czech',      code: 'cs' },
  { label: 'Slovak',     value: 'Slovak',     code: 'sk' },
  { label: 'Dutch',      value: 'Dutch',      code: 'nl' },
  { label: 'Turkish',    value: 'Turkish',    code: 'tr' },
  { label: 'Romanian',   value: 'Romanian',   code: 'ro' },
  { label: 'Hungarian',  value: 'Hungarian',  code: 'hu' },
  { label: 'Bulgarian',  value: 'Bulgarian',  code: 'bg' },
  { label: 'Greek',      value: 'Greek',      code: 'el' },
  { label: 'Chinese',    value: 'Chinese',    code: 'zh' },
  { label: 'Japanese',   value: 'Japanese',   code: 'ja' },
  { label: 'Korean',     value: 'Korean',     code: 'ko' },
  { label: 'Arabic',     value: 'Arabic',     code: 'ar' },
  { label: 'Hindi',      value: 'Hindi',      code: 'hi' }
];

module.exports = {
  PORT: parseInt(process.env.PORT || '3000', 10),
  HOST: process.env.HOST || '0.0.0.0',

  UPLOAD_DIR: process.env.UPLOAD_DIR || path.join(ROOT, 'uploads'),
  OUTPUT_SUBDIR: 'outputs',

  MAX_FILE_SIZE_MB: parseInt(process.env.MAX_FILE_SIZE_MB || '300', 10),
  ALLOWED_EXTENSIONS: (process.env.ALLOWED_EXTENSIONS ||
    '.mp4,.mov,.m4v,.avi,.mkv,.webm,.flv,.wmv,.3gp,.ts,.mpeg,.mpg,.ogv,.mts')
    .split(',').map(e => e.trim().toLowerCase()).filter(Boolean),

  // Max size of an edited SRT submitted via /apply
  MAX_SRT_SIZE_KB: parseInt(process.env.MAX_SRT_SIZE_KB || '2048', 10),

  TRANSCRIBE_SCRIPT: process.env.TRANSCRIBE_SCRIPT || path.join(ROOT, 'scripts', 'transcribe.sh'),
  BURN_SCRIPT: process.env.BURN_SCRIPT || path.join(ROOT, 'scripts', 'burn.sh'),

  // Whisper on CPU is slow — default job time limit is 4 hours (0 = unlimited)
  SCRIPT_TIMEOUT_MS: parseInt(process.env.SCRIPT_TIMEOUT_MS || '14400000', 10),

  FILE_TTL_MS: parseInt(process.env.FILE_TTL_HOURS || '24', 10) * 60 * 60 * 1000,
  CLEANUP_INTERVAL_MS: parseInt(process.env.CLEANUP_INTERVAL_MIN || '60', 10) * 60 * 1000,

  MODELS,
  LANGUAGES,

  // Support/donation link shown on the final screen (empty URL = hidden)
  SUPPORT_URL: process.env.SUPPORT_URL || '',
  SUPPORT_LINK_NAME: process.env.SUPPORT_LINK_NAME || 'Buy me a coffee',

  // --- Limits & licensing ---
  // Maximum allowed video duration (default 7 minutes)
  MAX_VIDEO_DURATION_SEC: parseInt(process.env.MAX_VIDEO_DURATION_SEC || '420', 10),
  // Files larger than this are compressed before transcription
  COMPRESS_THRESHOLD_MB: parseInt(process.env.COMPRESS_THRESHOLD_MB || '15', 10),
  // Compression target size (safety margin below the threshold)
  COMPRESS_TARGET_MB: parseInt(process.env.COMPRESS_TARGET_MB || '14', 10),
  // Free transcriptions per IP per day
  DAILY_LIMIT: parseInt(process.env.DAILY_LIMIT || '3', 10),
  // License key that lifts the daily limit (hardcoded default, override in .env)
  LICENSE_KEY: process.env.LICENSE_KEY || 'SUBS-7K2M-X9QF-4T8B-WL3D',
  // License cookie lifetime (default 1 week)
  LICENSE_TTL_DAYS: parseInt(process.env.LICENSE_TTL_DAYS || '7', 10),
  // Telegram contact for obtaining a license key
  TG_CONTACT: process.env.TG_CONTACT || '@it_link_a',

  // --- Legal identity (Impressum / Datenschutz) — FILL BEFORE GOING LIVE ---
  LEGAL: {
    name: process.env.LEGAL_NAME || '[Vor- und Nachname / Firmenname]',
    street: process.env.LEGAL_STREET || '[Straße und Hausnummer]',
    zipCity: process.env.LEGAL_ZIP_CITY || '[PLZ und Ort]',
    country: process.env.LEGAL_COUNTRY || 'Deutschland',
    email: process.env.LEGAL_EMAIL || '[E-Mail-Adresse]',
    phone: process.env.LEGAL_PHONE || '',
    vatId: process.env.LEGAL_VAT_ID || '', // USt-IdNr. (optional)
    // Responsible per § 18 Abs. 2 MStV (usually same as operator)
    responsible: process.env.LEGAL_RESPONSIBLE || ''
  },

  COMPRESS_SCRIPT: process.env.COMPRESS_SCRIPT || path.join(ROOT, 'scripts', 'compress.sh'),

  get OUTPUT_DIR() {
    return path.join(this.UPLOAD_DIR, this.OUTPUT_SUBDIR);
  }
};
