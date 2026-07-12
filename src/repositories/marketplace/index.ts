import { createPostgresMarketplaceRepository } from "./postgresMarketplaceRepository";
import type { MarketplaceRepository } from "./types";

let marketplaceRepository: MarketplaceRepository | null = null;

export const getMarketplaceRepository = (): MarketplaceRepository => {
  if (!marketplaceRepository) {
    marketplaceRepository = createPostgresMarketplaceRepository();
  }

  return marketplaceRepository;
};
