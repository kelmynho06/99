export type UserRole = 'passenger' | 'driver' | 'admin';

export type AccountStatus = 'active' | 'pending' | 'rejected' | 'suspended';

export type RideCategory = 'moto' | 'pop' | 'negocia' | 'delivery_moto' | 'delivery_car';

export type PaymentMethod = 'cash' | 'pix' | 'wallet';

export type PaymentStatus =
  | 'pending'
  | 'paid'
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

export type PixKeyType = 'cpf_cnpj' | 'email' | 'phone' | 'random';

export type AssistantVoiceId =
  | 'melissa-maps'
  | 'melissa-suave'
  | 'melissa-agil'
  | 'melissa-executiva';

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
  theme_preset?: string | null;
  assistant_voice_default?: AssistantVoiceId | string | null;
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
  pwa_app_name?: string | null;
  pwa_icon_url?: string | null;
  apk_app_name?: string | null;
  apk_icon_url?: string | null;
  deposit_window_enabled?: boolean;
  deposit_start_time?: string;
  deposit_end_time?: string;
  night_duty_enabled?: boolean;
  night_duty_start?: string;
  night_duty_end?: string;
  night_duty_auto_approve?: boolean;
  mp_auto_pix_enabled?: boolean;
  manual_pix_enabled?: boolean;
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
  attachment_url?: string | null;
  attachment_name?: string | null;
  attachment_type?: string | null;
  gps_lat?: number | null;
  gps_lng?: number | null;
  created_at: string;
}

export interface WeatherInfo {
  temperatureC: number;
  weatherCode: number;
  label: string;
  city: string;
}

export interface DriverVehicle {
  id: string;
  vehicle_type: 'car' | 'moto' | 'delivery';
  vehicle_model: string;
  vehicle_plate: string;
  vehicle_color: string;
}

export type DriverServiceMode = 'only_delivery' | 'only_passenger' | 'both';

export interface DriverDetails {
  user_id: string;
  cnh_url: string;
  crlv_url: string;
  vehicle_type: 'car' | 'moto' | 'delivery';
  service_mode?: DriverServiceMode;
  vehicle_model: string;
  vehicle_plate: string;
  vehicle_color: string;
  pix_key: string;
  pix_key_type?: PixKeyType;
  is_online: boolean;
  current_lat: number | null;
  current_lng: number | null;
  heading: number;
  acceptance_rate: number;
  completion_rate: number;
  rejection_reason?: string | null;
  updated_at: string;
  vehicles?: DriverVehicle[];
  active_vehicle_id?: string | null;
}

export type FacialVerificationStatus = 'pending' | 'approved' | 'rejected';

export interface DriverFacialVerification {
  id: string;
  driver_id: string;
  selfie_data_url: string;
  status: FacialVerificationStatus;
  queue_position?: number;
  reviewed_by?: string | null;
  rejection_reason?: string | null;
  created_at: string;
  reviewed_at?: string | null;
  driver?: UserProfile;
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
  reserved_balance?: number;
  pay66_key?: string | null;
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
  coupon_id?: string | null;
  user_coupon_id?: string | null;
  discount_amount?: number;
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
  auth_code?: string | null;
  sender_name?: string | null;
  recipient_name?: string | null;
  recipient_key?: string | null;
  created_at: string;
}

export interface Pay66DriverMatch {
  id: string;
  full_name: string;
  pay66_key: string;
  avatar_url?: string | null;
  phone?: string;
  vehicle_model?: string | null;
  vehicle_plate?: string | null;
}

export interface Pay66ReceiptResult {
  ok: boolean;
  already_paid?: boolean;
  ride_id: string;
  amount: number;
  auth_code: string;
  tx_id: string;
  created_at: string;
  sender_name: string;
  sender_key: string;
  recipient_name: string;
  recipient_key: string;
  new_passenger_balance?: number;
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
  pix_key_type?: PixKeyType | string | null;
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
  pay66_key?: string | null;
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
  assistant_voice_id?: AssistantVoiceId;
  assistant_voice_name?: string;
  assistant_use_gemini_tts?: boolean;
  driver_goal_day?: number;
  driver_goal_week?: number;
  driver_goal_month?: number;
}

export type PermissionGrantState = 'granted' | 'denied' | 'prompt' | 'unknown';

export interface DevicePermissionsState {
  notifications: PermissionGrantState;
  location: PermissionGrantState;
  camera: PermissionGrantState;
  microphone: PermissionGrantState;
  photos: PermissionGrantState;
}

export type NotificationCategory = 'general' | 'payment' | 'event' | 'coupon' | 'wallet';

export type NotificationTargetScope = 'all' | 'passengers' | 'drivers' | 'user';

export interface AppNotification {
  id: string;
  title: string;
  message: string;
  category: NotificationCategory;
  target_scope: NotificationTargetScope;
  target_user_id?: string | null;
  action_tab?: string | null;
  metadata?: Record<string, unknown>;
  created_by?: string | null;
  created_at: string;
  is_read?: boolean;
}

export interface Coupon {
  id: string;
  code: string;
  title: string;
  description: string;
  discount_type: 'percent' | 'fixed';
  discount_value: number;
  max_discount?: number | null;
  min_ride_fare: number;
  active: boolean;
  expires_at?: string | null;
  created_at: string;
}

export interface UserCoupon {
  id: string;
  coupon_id: string;
  user_id: string;
  status: 'available' | 'used' | 'revoked';
  used_ride_id?: string | null;
  granted_at: string;
  used_at?: string | null;
  coupon?: Coupon | null;
  user?: UserProfile;
}

export interface PagamentoPix {
  id: string;
  usuario_id: string;
  corrida_id?: string | null;
  tipo: 'recarga' | 'recarga_carteira' | 'corrida' | 'pagamento_corrida';
  metodo_confirmacao: 'mercadopago_auto' | 'manual_admin';
  mp_payment_id?: string | null;
  valor: number;
  qr_code?: string | null;
  qr_code_base64?: string | null;
  status: 'pendente' | 'aprovado' | 'cancelado' | 'expirado';
  criado_em: string;
  aprovado_em?: string | null;
  usuario?: UserProfile;
}
