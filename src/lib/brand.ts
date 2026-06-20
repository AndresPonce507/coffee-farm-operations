/**
 * Janson Coffee brand constants — sourced from jansoncoffee.com.
 * Single source of truth for naming, story facts, and palette references.
 */

export const BRAND = {
  name: "Janson Coffee",
  shortName: "Janson",
  family: "Janson Family Coffee",
  product: "Farm Operations",
  tagline: "From our farm to your cup since 1990",
  location: "Volcán, Chiriquí · Panamá",
  founded: 1926, // Carl Axel Janson arrived from Sweden
  established: 1990, // sons founded Janson Coffee
  altitudeRange: "1,350–1,700 masl",
  reserveHectares: 200,
  varieties: ["Geisha", "Caturra", "Catuaí", "Pacamara", "Typica"] as const,
} as const;

/** Brand palette (hex) — mirrors the @theme tokens in globals.css. */
export const PALETTE = {
  forest: "#00291D",
  forest600: "#0D4D37",
  forest500: "#1A6B4D",
  coffee: "#45361F",
  cherry: "#B5482E",
  honey: "#C8922E",
  sky: "#3B6EA5",
  paper: "#FAF7F1",
} as const;

/** Ordered chart colors for varieties / categorical data. */
export const CHART_COLORS = [
  PALETTE.forest500,
  PALETTE.honey,
  PALETTE.cherry,
  PALETTE.coffee,
  PALETTE.sky,
  PALETTE.forest600,
] as const;
