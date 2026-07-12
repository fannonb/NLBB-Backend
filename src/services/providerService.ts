import { getMarketplaceRepository } from "../repositories/marketplace";
import type { ProviderFilters } from "../repositories/marketplace/types";

export const listProviders = async (
  filters: ProviderFilters,
  currentUser?: { uid: string; role: string }
) => {
  return getMarketplaceRepository().listProviders(filters, currentUser);
};

export const getProviderById = async (id: string, currentUser?: { uid: string; role: string }) => {
  return getMarketplaceRepository().getProviderById(id, currentUser);
};
