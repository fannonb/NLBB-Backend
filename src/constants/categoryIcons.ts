export const CATEGORY_ICON_VALUES = [
  "scissors-cutting",
  "hair-dryer",
  "mustache",
  "hand-back-right-outline",
  "spa",
  "hand-heart",
  "face-woman-shimmer",
  "lipstick",
  "eye-outline",
  "flower-outline",
  "brush",
  "needle",
  "leaf-circle-outline",
  "star-four-points-outline",
] as const;

export type CategoryIcon = (typeof CATEGORY_ICON_VALUES)[number];

export const DEFAULT_CATEGORY_ICON: CategoryIcon = "star-four-points-outline";

export const DEFAULT_CATEGORY_ICONS: Record<string, CategoryIcon> = {
  barber: "mustache",
  hair: "scissors-cutting",
  nails: "hand-back-right-outline",
  massage: "hand-heart",
  facial: "face-woman-shimmer",
  tattoo: "brush",
  salon: "hair-dryer",
  spa: "spa",
  makeup: "lipstick",
  waxing: "flower-outline",
  lashes: "eye-outline",
  piercing: "needle",
};
