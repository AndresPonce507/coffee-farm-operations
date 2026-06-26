import { cache } from "react";

import { getSupabase } from "@/lib/supabase/server";

/**
 * /(app)/provenance OWNER read port (P3-S13 curation gate).
 *
 * The owner-only counterpart to the public microsite: it lists every lot-linked SKU
 * (P3-S11 `product_skus` ⨝ `products`) joined to its curation row (`provenance_pages`,
 * left — a SKU may have no page yet). Authenticated + tenant-scoped by RLS; the only
 * mutation path is the SECDEF publish/unpublish RPCs in `actions.ts` (no client
 * write grant on `provenance_pages`). READ-ONLY here.
 *
 * Product facts and the curation row are fetched in SEPARATE queries and joined in
 * JS by id (rather than a PostgREST embed) so a SKU with no page degrades to
 * `slug=null / isPublished=false` cleanly — the same join-in-JS posture the pricing
 * port uses for variety-by-code, and it sidesteps the embed's array-vs-object typing.
 */

export interface SkuCurationRow {
  skuId: number;
  greenLotCode: string;
  gtin: string | null;
  packFormat: string | null;
  bagSize: string | null;
  productName: string | null;
  variety: string | null;
  process: string | null;
  /** From the curation row; null when no page has ever been minted for this SKU. */
  slug: string | null;
  isPublished: boolean;
  curatedStory: string | null;
}

interface SkuRow {
  id: number;
  product_id: number;
  green_lot_code: string;
  gtin: string | null;
  pack_format: string | null;
  bag_size: string | null;
}

interface ProductRow {
  id: number;
  name: string | null;
  variety: string | null;
  process: string | null;
}

interface PageRow {
  sku_id: number;
  slug: string | null;
  is_published: boolean | null;
  curated_story: string | null;
}

export const getProvenanceCatalog = cache(
  async (): Promise<SkuCurationRow[]> => {
    const sb = await getSupabase();
    const [skus, products, pages] = await Promise.all([
      sb
        .from("product_skus")
        .select("id, product_id, green_lot_code, gtin, pack_format, bag_size")
        .order("id"),
      sb.from("products").select("id, name, variety, process"),
      sb.from("provenance_pages").select("sku_id, slug, is_published, curated_story"),
    ]);

    if (skus.error) throw new Error(`getProvenanceCatalog: ${skus.error.message}`);
    if (products.error) {
      throw new Error(`getProvenanceCatalog(products): ${products.error.message}`);
    }
    if (pages.error) {
      throw new Error(`getProvenanceCatalog(pages): ${pages.error.message}`);
    }

    const productById = new Map<number, ProductRow>(
      (products.data as ProductRow[]).map((p) => [p.id, p]),
    );
    const pageBySku = new Map<number, PageRow>(
      (pages.data as PageRow[]).map((p) => [p.sku_id, p]),
    );

    return (skus.data as SkuRow[]).map((s) => {
      const product = productById.get(s.product_id);
      const page = pageBySku.get(s.id);
      return {
        skuId: s.id,
        greenLotCode: s.green_lot_code,
        gtin: s.gtin,
        packFormat: s.pack_format,
        bagSize: s.bag_size,
        productName: product?.name ?? null,
        variety: product?.variety ?? null,
        process: product?.process ?? null,
        slug: page?.slug ?? null,
        isPublished: Boolean(page?.is_published),
        curatedStory: page?.curated_story ?? null,
      };
    });
  },
);
