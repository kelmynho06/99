export type UserRole = 'passenger' | 'driver' | 'admin';

export type AccountStatus = 'active' | 'pending' | 'rejected' | 'suspended';

export type RideCategory = 'moto' | 'pop' | 'negocia' | 'delivery_moto' | 'delivery_car';

export type PaymentMethod = 'cash' | 'pix' | 'wallet';

export type PaymentStatus =
  | 'pending'
  | 'paid_pix'
  | 'paid_cash'
  | 'paid_wallet'
  | 'disputed'
  | 'admin_settled';

export type RideStatus =
  | 'searching'
  | 'accepted'
  | 'arrived'
  | 'in_progress'
  | 'completed'
  | 'cancelled';

export type MapLayerMode = 'urban';

export type ThemeMode = 'light' | 'dark' | 'auto';

export type PeriodFilter = 'day' | 'week' | 'month' | 'all';

export interface SavedAddress {
  label: string;
  address: string;
  lat: number;
  lng: number;
}

export interface PlatformConfig {
  platform_pix_key: string;
  platform_pix_receiver: string;
  platform_city: string;
  company_address?: string | null;
  platform_pix_qr_url?: string | null;
  site_name: string;
  support_whatsapp: string;
  commission_percent: number;
  maintenance_mode: boolean;
  app_logo_url?: string | null;
  primary_color?: string | null;
  secondary_color?: string | null;
  vehicle_img_moto?: string | null;
  vehicle_img_pop?: string | null;
  vehicle_img_delivery_moto?: string | null;
  vehicle_img_delivery_car?: string | null;
  sound_offer_url?: string | null;
  sound_delivery_url?: string | null;
  sound_accepted_url?: string | null;
  sound_arrived_url?: string | null;
  sound_completed_url?: string | null;
  sound_chat_url?: string | null;
  sound_cancel_url?: string | null;
  ota_latest_version?: string | null;
  ota_apk_url?: string | null;
  ota_web_url?: string | null;
  ota_release_notes?: string | null;
}

export interface PlatformEvent {
  id: string;
  title: string;
  description: string;
  bonus_amount: number;
  target_role: 'all' | 'driver' | 'delivery';
  active: boolean;
  created_at: string;
}

export interface DirectMessage {
  id: string;
  user_id: string;
  sender_id: string;
  sender_name: string;
  sender_role: UserRole;
  content: string;
  created_at: string;
}

export interface WeatherInfo {
  temperatureC: number;
  weatherCode: number;
  label: string;
  city: string;
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
  is_admin?: boolean;
  status: AccountStatus;
  full_name: string;
  phone: string;
  email: string;
  cpf: string;
  avatar_url?: string | null;
  bio?: string | null;
  home_address?: SavedAddress | null;
  work_address?: SavedAddress | null;
  favorites?: SavedAddress[];
  preferred_payment?: PaymentMethod;
  preferred_language?: string | null;
  rating_avg: number;
  rating_count: number;
  wallet_balance: number;
  pending_debt_amount?: number;
  pending_debt_note?: string | null;
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
  payment_status: PaymentStatus;
  status: RideStatus;
  origin_address: string;
  origin_lat: number;
  origin_lng: number;
  destination_address: string;
  destination_lat: number;
  destination_lng: number;
  distance_km: number;
  estimated_fare: number;
  negotiated_fare?: number | null;
  final_fare: number | null;
  pin_code: string;
  require_pin?: boolean;
  delivery_photo_url?: string | null;
  pending_debt_included?: number;
  delivery_notes?: string | null;
  dispute_reason?: string | null;
  pix_declared_at?: string | null;
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
  type:
    | 'ride_earning'
    | 'payout'
    | 'dispute_settlement'
    | 'deposit'
    | 'ride_debit'
    | 'ride_refund'
    | 'admin_adjustment'
    | 'transfer_in'
    | 'transfer_out'
    | 'withdrawal'
    | 'withdrawal_refund';
  description: string;
  created_at: string;
}

export type WalletDepositStatus = 'pending' | 'approved' | 'rejected';

export interface WalletDeposit {
  id: string;
  user_id: string;
  amount: number;
  status: WalletDepositStatus;
  pix_payload?: string | null;
  note?: string | null;
  created_at: string;
  reviewed_at?: string | null;
  user?: UserProfile;
}

export type WalletWithdrawalStatus = 'pending' | 'paid' | 'rejected';

export interface WalletWithdrawal {
  id: string;
  user_id: string;
  amount: number;
  pix_key: string;
  status: WalletWithdrawalStatus;
  note?: string | null;
  created_at: string;
  reviewed_at?: string | null;
  user?: UserProfile;
}

export interface WalletRecipientMatch {
  id: string;
  full_name: string;
  email: string;
  phone: string;
  role: UserRole;
  avatar_url?: string | null;
}

export interface AuditLogEntry {
  id: string;
  user_id: string | null;
  user_name: string;
  user_email: string;
  user_role: UserRole | string;
  event_type: string;
  description: string;
  device_type: string;
  os_name: string;
  os_version: string;
  browser_name: string;
  browser_version: string;
  app_version: string;
  screen_size: string;
  language: string;
  timezone: string;
  user_agent: string;
  metadata?: Record<string, unknown>;
  created_at: string;
}

export interface GeoPoint {
  lat: number;
  lng: number;
  address: string;
}

export interface UserPreferences {
  voice_enabled: boolean;
  sounds_enabled: boolean;
  notifications_enabled: boolean;
  language: string;
  theme_mode: ThemeMode;
  map_layer: MapLayerMode;
  hud_compass_enabled: boolean;
  floating_bubble_enabled?: boolean;
}

export type PermissionGrantState = 'granted' | 'denied' | 'prompt' | 'unknown';

export interface DevicePermissionsState {
  notifications: PermissionGrantState;
  location: PermissionGrantState;
  camera: PermissionGrantState;
  microphone: PermissionGrantState;
  photos: PermissionGrantState;
}
