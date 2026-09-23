export type UploadOptions = {
  durable?: boolean;
  models: string[];
  languages: { label: string; value: string; code: string }[];
  maxFileSizeMb: number;
  maxDurationSec: number;
  allowedExtensions: string[];
  dailyLimit: number;
  tgContact: string;
};
export type LicenseStatus = { active: boolean; remaining: number | null; dailyLimit: number };
