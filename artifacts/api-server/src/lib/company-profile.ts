/**
 * The business's identity on its estimates — phase 8, Kyle's Video 6. Reading it
 * never fails: until it is filled in, the name falls back to the email sender's
 * name, and nothing else is shown.
 */
import { eq } from "drizzle-orm";
import { companyProfileTable, db } from "@workspace/db";
export { contactLines, formatPhone, jpegSize, logoOf, profileOf, MAX_FOOTER, MAX_LOGO_BYTES } from "./company-profile-rules.ts";

const ORG = "default";

export interface CompanyProfile {
  businessName: string;
  address: string | null; city: string | null; state: string | null; zip: string | null;
  phone: string | null; email: string | null; website: string | null;
  hasLogo: boolean; logoWidth: number | null; logoHeight: number | null;
  estimateFooter: string | null;
  showUnitPrices: boolean;
  showServiceDescriptions: boolean;
  updatedBy: string | null;
  updatedAt: string | null;
}

export const fallbackBusinessName = () => process.env.EMAIL_FROM_NAME?.trim() || "Superior Professional Window Cleaning";

export async function readCompanyProfile(): Promise<CompanyProfile & { logo: { jpeg: Buffer; width: number; height: number } | null }> {
  const [row] = await db.select().from(companyProfileTable).where(eq(companyProfileTable.organizationKey, ORG)).limit(1);
  const logo = row?.logoJpeg && row.logoWidth && row.logoHeight
    ? { jpeg: Buffer.from(row.logoJpeg, "base64"), width: row.logoWidth, height: row.logoHeight } : null;
  return {
    businessName: row?.businessName?.trim() || fallbackBusinessName(),
    address: row?.address ?? null, city: row?.city ?? null, state: row?.state ?? null, zip: row?.zip ?? null,
    phone: row?.phone ?? null, email: row?.email ?? null, website: row?.website ?? null,
    hasLogo: Boolean(logo), logoWidth: logo?.width ?? null, logoHeight: logo?.height ?? null,
    estimateFooter: row?.estimateFooter ?? null,
    showUnitPrices: row?.showUnitPrices ?? true,
    showServiceDescriptions: row?.showServiceDescriptions ?? true,
    updatedBy: row?.updatedBy ?? null,
    updatedAt: row?.updatedAt ? row.updatedAt.toISOString() : null,
    logo,
  };
}

export async function writeCompanyProfile(profile: Record<string, string | boolean | null>, updatedBy: string | null) {
  await db.insert(companyProfileTable).values({ organizationKey: ORG, ...profile, updatedBy })
    .onConflictDoUpdate({ target: companyProfileTable.organizationKey, set: { ...profile, updatedBy, updatedAt: new Date() } });
}

export async function writeCompanyLogo(logo: { jpeg: Buffer; width: number; height: number } | null, updatedBy: string | null) {
  const values = logo
    ? { logoJpeg: logo.jpeg.toString("base64"), logoWidth: logo.width, logoHeight: logo.height }
    : { logoJpeg: null, logoWidth: null, logoHeight: null };
  await db.insert(companyProfileTable).values({ organizationKey: ORG, ...values, updatedBy })
    .onConflictDoUpdate({ target: companyProfileTable.organizationKey, set: { ...values, updatedBy, updatedAt: new Date() } });
}
