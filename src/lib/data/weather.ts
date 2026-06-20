import type { WeatherDay } from "@/lib/types";

/**
 * 5-day forecast for Volcán, Chiriquí (≈1,450 masl highland coffee country).
 * Cool tropical-highland climate: mild highs (20–24 °C), cool nights (12–15 °C),
 * and the classic green-season pattern of clear mornings giving way to heavy
 * afternoon rain and lingering cloud/fog rolling off the Barú volcano.
 *
 * Deterministic literal data only (today for the mock app is 2026-06-20).
 */
export const weather: WeatherDay[] = [
  { day: "Today", hi: 22, lo: 14, rainPct: 65, icon: "rain" },
  { day: "Sat", hi: 23, lo: 14, rainPct: 45, icon: "cloud" },
  { day: "Sun", hi: 24, lo: 15, rainPct: 25, icon: "sun" },
  { day: "Mon", hi: 21, lo: 13, rainPct: 80, icon: "rain" },
  { day: "Tue", hi: 20, lo: 12, rainPct: 55, icon: "fog" },
];
