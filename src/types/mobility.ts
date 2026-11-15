export type UserRole = 'passenger' | 'driver' | 'admin';

export type AccountStatus = 'active' | 'pending' | 'rejected' | 'suspended';

export type RideCategory = 'pop' | 'moto' | 'delivery';

export type PaymentMethod = 'pix' | 'cash' | 'card_machine';

export type RideStatus =
  | 'searching'
  | 'accepted'
  | 'arrived'
  | 'in_progress'
  | 'completed'
  | 'cancelled';

export interface SavedAddress {
  label: string;
  address: string;
  lat: number;
  lng: number;
}

export interface DriverDetails {
  user_id: string;
  cnh_url: string;
  crlv_url: string;
  vehicle_type: 'car' | 'moto' | 'delivery';
  vehicle_model: string;
  vehicle_plate: string;
  vehicle_color: string;
  pix_key: string;
  is_online: boolean;
  current_lat: number | null;
  current_lng: number | null;
  heading: number;
  acceptance_rate: number;
  completion_rate: number;
  rejection_reason?: string | null;
  updated_at: string;
}

export interface UserProfile {
  id: string;
  role: UserRole;
  status: AccountStatus;
  full_name: string;
  phone: string;
  email: string;
  cpf: string;
  avatar_url?: string | null;
  home_address?: SavedAddress | null;
  work_address?: SavedAddress | null;
  preferred_payment?: PaymentMethod;
  rating_avg: number;
  rating_count: number;
  wallet_balance: number;
  is_anonymized?: boolean;
  created_at: string;
  driver?: DriverDetails | null;
}

export interface PricingSetting {
  category: RideCategory;
  label: string;
  description: string;
  base_fare: number;
  per_km_rate: number;
  min_fare: number;
  active: boolean;
}

export interface Ride {
  id: string;
  passenger_id: string;
  driver_id: string | null;
  category: RideCategory;
  payment_method: PaymentMethod;
  status: RideStatus;
  origin_address: string;
  origin_lat: number;
  origin_lng: number;
  destination_address: string;
  destination_lat: number;
  destination_lng: number;
  distance_km: number;
  estimated_fare: number;
  final_fare: number | null;
  pin_code: string;
  delivery_notes?: string | null;
  created_at: string;
  accepted_at: string | null;
  arrived_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  passenger_rating_submitted?: boolean;
  driver_rating_submitted?: boolean;
  passenger?: UserProfile;
  driver?: UserProfile;
}

export interface RideMessage {
  id: string;
  ride_id: string;
  sender_id: string;
  sender_name: string;
  content: string;
  created_at: string;
}

export interface WalletTransaction {
  id: string;
  user_id: string;
  ride_id?: string | null;
  amount: number;
  type: 'ride_earning' | 'ride_payment' | 'payout';
  description: string;
  created_at: string;
}

export interface GeoPoint {
  lat: number;
  lng: number;
  address: string;
}
