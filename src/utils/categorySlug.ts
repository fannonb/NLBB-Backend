/**
 * Maps provider-signup or legacy slugs to the canonical marketplace slug
 * (aligned with seed + ensureDefaultCategories).
 */
const SLUG_ALIASES: Record<string, string> = {
  tatoo: "tattoo",
  "tattoo-artist": "tattoo",
  "tattoo-studio": "tattoo",
  "tattoos": "tattoo",
  "barber-shop": "barber",
  "barbers": "barber",
  "barbershop": "barber",
};

export function canonicalCategorySlug(slug: string): string {
  const s = slug.trim().toLowerCase();
  return SLUG_ALIASES[s] ?? s;
}

/** All DB slug values that should resolve to the same canonical category. */
export function allSlugsForCanonical(canonical: string): string[] {
  const c = canonical.trim().toLowerCase();
  const out = new Set<string>([c]);
  for (const [alias, target] of Object.entries(SLUG_ALIASES)) {
    if (target === c) {
      out.add(alias);
    }
  }
  return [...out];
}
