import type { Provider } from "../../types/domain";

export interface ProviderFilters {
  search?: string;
  category?: string;
  onlySubscribed?: boolean;
}

export interface AuthContext {
  uid: string;
  role: string;
}

export type ProviderListItem = Provider & { isSubscribed: boolean };

export interface MarketplaceCategory {
  id: string;
  name: string;
  icon: string;
  slug?: string;
  sortOrder?: number;
  isActive?: boolean;
}

export interface MarketplaceRepository {
  listCategories(): Promise<MarketplaceCategory[]>;
  listProviders(filters: ProviderFilters, currentUser?: AuthContext): Promise<ProviderListItem[]>;
  getProviderById(id: string, currentUser?: AuthContext): Promise<ProviderListItem | null>;
}
