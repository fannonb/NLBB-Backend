export type UserRole = "customer" | "provider" | "admin";
export type UserAccountStatus = "active" | "disabled";

export type BookingStatus =
  | "pending"
  | "accepted"
  | "rejected"
  | "completed"
  | "cancelled";

export type SubscriptionStatus = "active" | "expired" | "pending" | "suspended";

export interface GeoPointLike {
  lat: number;
  lng: number;
}

export interface Service {
  id: string;
  name: string;
  description: string;
  duration: number;
  price: number;
  category: string;
  isActive?: boolean;
}

export interface WorkingHoursDay {
  day: string;
  isOpen: boolean;
  openTime: string;
  closeTime: string;
}

export interface Provider {
  id: string;
  ownerUserId: string;
  name: string;
  category: string;
  description: string;
  avatar?: string;
  coverImage?: string;
  images?: string[];
  rating: number;
  reviewCount: number;
  location: string;
  address: string;
  phone?: string;
  whatsapp?: string;
  instagram?: string;
  facebook?: string;
  mpesaPhone?: string;
  openTime: string;
  closeTime: string;
  workDays: string;
  workingHours?: WorkingHoursDay[];
  priceFrom: number;
  isVerified: boolean;
  isOpen: boolean;
  services: Service[];
  coordinates?: GeoPointLike;
  galleryImages?: string[];
  createdAt: string;
  updatedAt: string;
}

export interface Booking {
  id: string;
  ref: string;
  customerId: string;
  providerId: string;
  providerName: string;
  serviceName: string;
  servicePrice: number;
  scheduledAt: string;
  endAt: string;
  duration: number;
  status: BookingStatus;
  notes?: string;
  /** Listed service price; customer pays provider on site — no app fee added. */
  totalAmount: number;
  /** Always 0 for NLBB customer bookings (schema compatibility). */
  platformFee: number;
  createdAt: string;
  updatedAt: string;
  providerServiceId?: string | null;
  reviewId?: string | null;
}

export interface Subscription {
  providerId: string;
  status: SubscriptionStatus;
  renewalDate: string;
  amount: number;
  planAmount: number;
  creditBalance: number;
  paymentMethod: "mpesa";
  lastPaymentId?: string;
  updatedAt: string;
}

export interface Payment {
  id: string;
  providerId: string;
  amount: number;
  phoneNumber: string;
  method: "mpesa";
  status: "pending" | "success" | "failed";
  checkoutRequestId: string;
  merchantRequestId?: string;
  mpesaReceiptNumber?: string;
  rawCallback?: unknown;
  createdAt: string;
  updatedAt: string;
}

export interface Notification {
  id: string;
  userId: string;
  title: string;
  body: string;
  type: "booking" | "payment" | "subscription" | "review" | "general";
  actionType?:
    | "customer_bookings"
    | "provider_appointment_detail"
    | "provider_subscription"
    | "provider_reviews";
  actionId?: string;
  isRead: boolean;
  createdAt: string;
}

export interface Favorite {
  id: string;
  userId: string;
  providerId: string;
  createdAt: string;
}

export interface Review {
  id: string;
  providerId: string;
  customerId: string;
  bookingId: string;
  userName: string;
  userAvatar?: string;
  serviceName: string;
  rating: number;
  comment: string;
  createdAt: string;
  updatedAt: string;
}
