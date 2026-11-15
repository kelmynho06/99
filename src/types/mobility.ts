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

export interface DriverDetails {
  user_id: string;
  cnh_url: string;
  crlv_url: string;
  vehicle_type: 'car' | 'moto';
  vehicle_model: string;
  vehicle_plate: string;
  vehicle_color: string;
  pix_key: string;
  is_online: boolean;
  current_lat: number | null;
  current_lng: number | null;
  heading: number;
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
  rating_avg: number;
  rating_count: number;
  wallet_balance: number;
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

export interface ServerStateSnapshot {
  rides: Ride[];
  pricing: PricingSetting[];
  onlineDrivers: UserProfile[];
  messagesByRide: Record<string, RideMessage[]>;
}
