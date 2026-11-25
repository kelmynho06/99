import { haversineKm } from './geo';
import { supabase, supabaseAnonKey, supabaseUrl } from './supabase';
import type {
  AppNotification,
  Coupon,
  DirectMessage,
  DriverDetails,
  DriverVehicle,
  GeoPoint,
  NotificationCategory,
  NotificationTargetScope,
  PaymentMethod,
  PaymentStatus,
  PlatformConfig,
  PlatformEvent,
  PricingSetting,
  Ride,
  RideCategory,
  RideMessage,
  RideStatus,
  SavedAddress,
  UserCoupon,
  UserProfile,
  WalletDeposit,
  WalletDepositStatus,
  WalletRecipientMatch,
  WalletTransaction,
  WalletWithdrawal,
  WalletWithdrawalStatus,
} from '../types/mobility';

export const PLATFORM_BRAND_CACHE_KEY = 'velo99_platform_brand_cache_v1';

export const DEFAULT_PLATFORM_CONFIG: PlatformConfig = {
  platform_pix_key: 'pix@godriver.app',
  platform_pix_receiver: 'Go Driver Mobilidade',
  platform_city: 'São Paulo, SP',
  company_address: '',
  platform_pix_qr_url: null,
  site_name: 'Go Driver Mobilidade',
  support_whatsapp: '',
  commission_percent: 0,
  maintenance_mode: false,
  app_logo_url: null,
  primary_color: '#2563EB',
  secondary_color: '#0F172A',
  vehicle_img_moto: null,
  vehicle_img_pop: null,
  vehicle_img_delivery_moto: null,
  vehicle_img_delivery_car: null,
  sound_offer_url: null,
  sound_delivery_url: null,
  sound_accepted_url: null,
  sound_arrived_url: null,
  sound_completed_url: null,
  sound_chat_url: null,
  sound_cancel_url: null,
  ota_latest_version: '1.2.2',
  ota_apk_url: null,
  ota_web_url: null,
  ota_release_notes: null,
  deposit_window_enabled: true,
  deposit_start_time: '07:00',
  deposit_end_time: '23:30',
};

function normalizeHHMM(raw: string | null | undefined, fallback: string): string {
  const clean = String(raw || '').trim();
  const match = clean.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return fallback;
  const h = Math.min(23, Math.max(0, Number(match[1])));
  const m = Math.min(59, Math.max(0, Number(match[2])));
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function getDepositWindowStatus(
  config?: PlatformConfig | null,
  now: Date = new Date()
): { isOpen: boolean; enabled: boolean; startTime: string; endTime: string } {
  const enabled = config?.deposit_window_enabled !== false;
  const startTime = normalizeHHMM(config?.deposit_start_time, '07:00');
  const endTime = normalizeHHMM(config?.deposit_end_time, '23:30');
  if (!enabled) {
    return { isOpen: true, enabled: false, startTime, endTime };
  }
  const [sh, sm] = startTime.split(':').map(Number);
  const [eh, em] = endTime.split(':').map(Number);
  const startMin = sh * 60 + sm;
  const endMin = eh * 60 + em;
  const curMin = now.getHours() * 60 + now.getMinutes();

  const isOpen =
    startMin <= endMin
      ? curMin >= startMin && curMin <= endMin
      : curMin >= startMin || curMin <= endMin;

  return { isOpen, enabled: true, startTime, endTime };
}

export const DEFAULT_PRICING_LIST: PricingSetting[] = [
  {
    category: 'moto',
    label: 'Moto',
    description: 'Deslocamento rápido no trânsito',
    base_fare: 3.0,
    per_km_rate: 1.35,
    min_fare: 6.0,
    active: true,
  },
  {
    category: 'pop',
    label: 'Pop',
    description: 'Conforto com ar-condicionado',
    base_fare: 4.5,
    per_km_rate: 2.15,
    min_fare: 8.5,
    active: true,
  },
  {
    category: 'negocia',
    label: 'Negocia',
    description: 'Sugira o valor da sua viagem',
    base_fare: 4.0,
    per_km_rate: 1.9,
    min_fare: 7.5,
    active: true,
  },
  {
    category: 'delivery_moto',
    label: 'Entrega Moto',
    description: 'Pacotes rápidos com código PIN',
    base_fare: 3.5,
    per_km_rate: 1.55,
    min_fare: 7.0,
    active: true,
  },
  {
    category: 'delivery_car',
    label: 'Entrega Carro',
    description: 'Volumes maiores com código PIN',
    base_fare: 5.0,
    per_km_rate: 2.25,
    min_fare: 9.5,
    active: true,
  },
];

const DRIVER_VEHICLES_CACHE_PREFIX = 'boreal_driver_vehicles_v1_';

export function rideMatchesDriverVehicle(
  category: RideCategory,
  vehicleType?: 'car' | 'moto' | 'delivery' | null
): boolean {
  if (!vehicleType) return false;
  if (vehicleType === 'moto') {
    return category === 'moto' || category === 'delivery_moto';
  }
  if (vehicleType === 'car') {
    return category === 'pop' || category === 'negocia' || category === 'delivery_car';
  }
  if (vehicleType === 'delivery') {
    return category === 'delivery_moto' || category === 'delivery_car';
  }
  return false;
}

function readCachedDriverVehicles(
  userId: string
): { vehicles: DriverVehicle[]; activeVehicleId: string | null } | null {
  if (!userId || typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(`${DRIVER_VEHICLES_CACHE_PREFIX}${userId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as {
      vehicles?: DriverVehicle[];
      activeVehicleId?: string | null;
    };
    if (!Array.isArray(parsed.vehicles) || parsed.vehicles.length === 0) return null;
    return {
      vehicles: parsed.vehicles,
      activeVehicleId: parsed.activeVehicleId || parsed.vehicles[0]?.id || null,
    };
  } catch {
    return null;
  }
}

function writeCachedDriverVehicles(
  userId: string,
  vehicles: DriverVehicle[],
  activeVehicleId: string | null
): void {
  if (!userId || typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      `${DRIVER_VEHICLES_CACHE_PREFIX}${userId}`,
      JSON.stringify({ vehicles, activeVehicleId })
    );
  } catch {
    // Ignore storage quota errors
  }
}

function normalizeDriverVehiclesFromRow(row: Record<string, unknown>): {
  vehicles: DriverVehicle[];
  activeVehicleId: string;
} {
  const userId = String(row.user_id || '');
  const baseVehicle: DriverVehicle = {
    id: 'veh-1',
    vehicle_type: (row.vehicle_type as 'car' | 'moto' | 'delivery') || 'car',
    vehicle_model: String(row.vehicle_model || ''),
    vehicle_plate: String(row.vehicle_plate || ''),
    vehicle_color: String(row.vehicle_color || ''),
  };

  let list: DriverVehicle[] = [];
  if (Array.isArray(row.vehicles) && row.vehicles.length > 0) {
    list = (row.vehicles as Array<Record<string, unknown>>)
      .map((v, idx): DriverVehicle => {
        const vType: DriverVehicle['vehicle_type'] =
          v.vehicle_type === 'moto' || v.vehicle_type === 'delivery' ? v.vehicle_type : 'car';
        return {
          id: String(v.id || `veh-${idx + 1}`),
          vehicle_type: vType,
          vehicle_model: String(v.vehicle_model || ''),
          vehicle_plate: String(v.vehicle_plate || '').toUpperCase(),
          vehicle_color: String(v.vehicle_color || ''),
        };
      })
      .filter((v) => v.vehicle_model || v.vehicle_plate);
  }

  if (list.length === 0) {
    const cached = readCachedDriverVehicles(userId);
    if (cached && cached.vehicles.length > 0) {
      list = cached.vehicles;
    }
  }

  if (list.length === 0) {
    list = [baseVehicle];
  }

  const rowActiveId = row.active_vehicle_id ? String(row.active_vehicle_id) : null;
  const cachedActiveId = readCachedDriverVehicles(userId)?.activeVehicleId || null;
  let active =
    list.find((v) => v.id === (rowActiveId || cachedActiveId)) ||
    list.find(
      (v) =>
        v.vehicle_type === baseVehicle.vehicle_type &&
        v.vehicle_plate.toUpperCase() === baseVehicle.vehicle_plate.toUpperCase()
    ) ||
    list[0];

  if (
    baseVehicle.vehicle_model &&
    (active.vehicle_type !== baseVehicle.vehicle_type ||
      active.vehicle_plate.toUpperCase() !== baseVehicle.vehicle_plate.toUpperCase())
  ) {
    const matchingExisting = list.find(
      (v) =>
        v.vehicle_type === baseVehicle.vehicle_type &&
        v.vehicle_plate.toUpperCase() === baseVehicle.vehicle_plate.toUpperCase()
    );
    if (matchingExisting) {
      active = matchingExisting;
    } else {
      active = { ...baseVehicle, id: active.id || 'veh-1' };
      list = list.map((v) => (v.id === active.id ? active : v));
    }
  }

  return { vehicles: list, activeVehicleId: active.id };
}

function mapDbDriver(row: Record<string, unknown> | null | undefined): DriverDetails | null {
  if (!row) return null;
  const { vehicles, activeVehicleId } = normalizeDriverVehiclesFromRow(row);
  return {
    user_id: String(row.user_id || ''),
    cnh_url: String(row.cnh_url || ''),
    crlv_url: String(row.crlv_url || ''),
    vehicle_type: (row.vehicle_type as 'car' | 'moto' | 'delivery') || 'car',
    vehicle_model: String(row.vehicle_model || ''),
    vehicle_plate: String(row.vehicle_plate || ''),
    vehicle_color: String(row.vehicle_color || ''),
    pix_key: String(row.pix_key || ''),
    is_online: Boolean(row.is_online),
    current_lat: typeof row.current_lat === 'number' ? row.current_lat : null,
    current_lng: typeof row.current_lng === 'number' ? row.current_lng : null,
    heading: typeof row.heading === 'number' ? row.heading : 0,
    acceptance_rate: Number(row.acceptance_rate ?? 100),
    completion_rate: Number(row.completion_rate ?? 100),
    rejection_reason: row.rejection_reason ? String(row.rejection_reason) : null,
    updated_at: String(row.updated_at || new Date().toISOString()),
    vehicles,
    active_vehicle_id: activeVehicleId,
  };
}

export function mapDbProfile(
  row: Record<string, unknown>,
  driverRow?: Record<string, unknown> | null
): UserProfile {
  const email = String(row.email || '').toLowerCase();
  const isAdminFlag = Boolean(row.is_admin ?? false);
  const rawRole = String(row.role || 'passenger');
  const role: UserProfile['role'] =
    isAdminFlag || rawRole === 'admin'
      ? 'admin'
      : rawRole === 'driver'
      ? 'driver'
      : 'passenger';
  const status = String(row.status || 'active') as UserProfile['status'];

  return {
    id: String(row.id),
    role,
    is_admin: isAdminFlag || role === 'admin',
    status,
    full_name: String(row.full_name || ''),
    phone: String(row.phone || ''),
    email,
    cpf: String(row.cpf || ''),
    avatar_url: row.avatar_url ? String(row.avatar_url) : null,
    bio: row.bio ? String(row.bio) : null,
    home_address: (row.home_address as SavedAddress | null) ?? null,
    work_address: (row.work_address as SavedAddress | null) ?? null,
    favorites: Array.isArray(row.favorites) ? (row.favorites as SavedAddress[]) : [],
    preferred_payment:
      row.preferred_payment === 'wallet'
        ? 'wallet'
        : row.preferred_payment === 'cash'
        ? 'cash'
        : 'pix',
    preferred_language: row.preferred_language ? String(row.preferred_language) : 'pt-BR',
    rating_avg: Number(row.rating_avg ?? 5),
    rating_count: Number(row.rating_count ?? 0),
    wallet_balance: Number(row.wallet_balance ?? 0),
    reserved_balance: Number(row.reserved_balance ?? 0),
    pay66_key: row.pay66_key
      ? String(row.pay66_key)
      : `BOREAL-${String(row.id).replace(/-/g, '').slice(0, 8).toUpperCase()}`,
    pending_debt_amount: Number(row.pending_debt_amount ?? 0),
    pending_debt_note: row.pending_debt_note ? String(row.pending_debt_note) : null,
    is_anonymized: Boolean(row.is_anonymized ?? false),
    created_at: String(row.created_at || new Date().toISOString()),
    driver: driverRow ? mapDbDriver(driverRow) : null,
  };
}

export function mapDbRide(
  row: Record<string, unknown>,
  profilesById?: Map<string, UserProfile>
): Ride {
  const passengerId = String(row.passenger_id || '');
  const driverId = row.driver_id ? String(row.driver_id) : null;
  const rawCat = String(row.category || 'pop');
  const category: RideCategory =
    rawCat === 'delivery'
      ? 'delivery_moto'
      : (rawCat as RideCategory);
  const status = String(row.status || 'searching') as RideStatus;
  const paymentMethod: PaymentMethod =
    row.payment_method === 'wallet'
      ? 'wallet'
      : row.payment_method === 'cash'
      ? 'cash'
      : 'pix';
  const defaultPaymentStatus: PaymentStatus =
    status === 'completed' && paymentMethod === 'cash' ? 'paid_cash' : 'pending';

  return {
    id: String(row.id),
    passenger_id: passengerId,
    driver_id: driverId,
    category,
    payment_method: paymentMethod,
    payment_status: (row.payment_status as PaymentStatus) || defaultPaymentStatus,
    status,
    origin_address: String(row.origin_address || ''),
    origin_lat: Number(row.origin_lat ?? 0),
    origin_lng: Number(row.origin_lng ?? 0),
    destination_address: String(row.destination_address || ''),
    destination_lat: Number(row.destination_lat ?? 0),
    destination_lng: Number(row.destination_lng ?? 0),
    distance_km: Number(row.distance_km ?? 0),
    estimated_fare: Number(row.estimated_fare ?? 0),
    negotiated_fare:
      typeof row.negotiated_fare === 'number' ? row.negotiated_fare : null,
    final_fare: typeof row.final_fare === 'number' ? row.final_fare : null,
    pin_code: String(row.pin_code || '0000'),
    require_pin: row.require_pin === undefined ? true : Boolean(row.require_pin),
    delivery_photo_url: row.delivery_photo_url ? String(row.delivery_photo_url) : null,
    pending_debt_included: Number(row.pending_debt_included ?? 0),
    delivery_notes: row.delivery_notes ? String(row.delivery_notes) : null,
    dispute_reason: row.dispute_reason ? String(row.dispute_reason) : null,
    pix_declared_at: row.pix_declared_at ? String(row.pix_declared_at) : null,
    coupon_id: row.coupon_id ? String(row.coupon_id) : null,
    user_coupon_id: row.user_coupon_id ? String(row.user_coupon_id) : null,
    discount_amount: Number(row.discount_amount ?? 0),
    created_at: String(row.created_at || new Date().toISOString()),
    accepted_at: row.accepted_at ? String(row.accepted_at) : null,
    arrived_at: row.arrived_at ? String(row.arrived_at) : null,
    started_at: row.started_at ? String(row.started_at) : null,
    completed_at: row.completed_at ? String(row.completed_at) : null,
    passenger_rating_submitted: Boolean(row.passenger_rating_submitted ?? false),
    driver_rating_submitted: Boolean(row.driver_rating_submitted ?? false),
    passenger: profilesById?.get(passengerId),
    driver: driverId ? profilesById?.get(driverId) : undefined,
  };
}

export async function compressImageFileToDataUrl(
  file: File,
  maxWidth = 1024,
  quality = 0.7
): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Falha ao ler imagem'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => resolve(String(reader.result));
      img.onload = () => {
        const scale = img.width > maxWidth ? maxWidth / img.width : 1;
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(String(reader.result));
          return;
        }
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

export const compressCameraImage = compressImageFileToDataUrl;

async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const res = await fetch(dataUrl);
  return res.blob();
}

async function isPublicStorageUrlReadable(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { method: 'HEAD' });
    return res.ok;
  } catch {
    return false;
  }
}

async function uploadPublicOrSignedAsset(
  filePath: string,
  blob: Blob,
  contentType: string,
  fallbackDataUrl: string
): Promise<string> {
  // 1. Try dedicated public bucket first
  try {
    const { error: pubErr } = await supabase.storage
      .from('public-assets')
      .upload(filePath, blob, { contentType, upsert: true });
    if (!pubErr) {
      const { data: pub } = supabase.storage.from('public-assets').getPublicUrl(filePath);
      if (pub?.publicUrl && (await isPublicStorageUrlReadable(pub.publicUrl))) {
        return pub.publicUrl;
      }
    }
  } catch {
    // Continue to driver-documents bucket fallback
  }

  // 2. Try driver-documents bucket and store as resolvable signed reference (storage:driver-documents/...)
  try {
    const { error: privErr } = await supabase.storage
      .from('driver-documents')
      .upload(filePath, blob, { contentType, upsert: true });
    if (!privErr) {
      const { data: pub2 } = supabase.storage.from('driver-documents').getPublicUrl(filePath);
      if (pub2?.publicUrl && (await isPublicStorageUrlReadable(pub2.publicUrl))) {
        return pub2.publicUrl;
      }
      return `storage:driver-documents/${filePath}`;
    }
  } catch {
    // Fallback to inline compressed JPEG/audio Data URL
  }

  return fallbackDataUrl;
}

async function uploadDriverDocOrFallback(
  userId: string,
  docType: 'cnh' | 'crlv',
  dataUrl: string
): Promise<string> {
  if (!dataUrl || !dataUrl.startsWith('data:')) return dataUrl;
  try {
    const blob = await dataUrlToBlob(dataUrl);
    const filePath = `${userId}/${docType}_${Date.now()}.jpg`;
    const { error } = await supabase.storage
      .from('driver-documents')
      .upload(filePath, blob, { contentType: 'image/jpeg', upsert: true });
    if (!error) {
      return `storage:driver-documents/${filePath}`;
    }
  } catch {
    // Fallback to inline compressed data URL if bucket isn't ready
  }
  return dataUrl;
}

export async function uploadUserAvatar(userId: string, dataUrl: string): Promise<string> {
  if (!dataUrl || !dataUrl.startsWith('data:')) return dataUrl;
  try {
    const blob = await dataUrlToBlob(dataUrl);
    const filePath = `avatars/${userId}_${Date.now()}.jpg`;
    return await uploadPublicOrSignedAsset(filePath, blob, 'image/jpeg', dataUrl);
  } catch {
    return dataUrl;
  }
}

export async function uploadDeliveryProofPhoto(rideId: string, dataUrl: string): Promise<string> {
  if (!dataUrl || !dataUrl.startsWith('data:')) return dataUrl;
  try {
    const blob = await dataUrlToBlob(dataUrl);
    const filePath = `deliveries/${rideId}_${Date.now()}.jpg`;
    return await uploadPublicOrSignedAsset(filePath, blob, 'image/jpeg', dataUrl);
  } catch {
    return dataUrl;
  }
}

export async function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Falha ao ler arquivo selecionado.'));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(file);
  });
}

export async function uploadPlatformAssetFile(
  file: File,
  kind:
    | 'logo'
    | 'pix_qr'
    | 'moto'
    | 'pop'
    | 'delivery_moto'
    | 'delivery_car'
    | 'sound_offer'
    | 'sound_delivery'
    | 'sound_accepted'
    | 'sound_arrived'
    | 'sound_completed'
    | 'sound_chat'
    | 'sound_cancel'
): Promise<string> {
  const isImage = file.type.startsWith('image/');
  const dataUrl = isImage
    ? await compressImageFileToDataUrl(file, 720, kind === 'pix_qr' ? 0.88 : 0.72)
    : await fileToDataUrl(file);
  const ext = isImage ? 'jpg' : file.name.split('.').pop()?.toLowerCase() || 'mp3';
  const contentType = isImage ? 'image/jpeg' : file.type || 'audio/mpeg';

  try {
    const blob = await dataUrlToBlob(dataUrl);
    const filePath = `platform/${kind}_${Date.now()}.${ext}`;
    return await uploadPublicOrSignedAsset(filePath, blob, contentType, dataUrl);
  } catch {
    return dataUrl;
  }
}

export async function resolveDocumentDisplayUrl(rawUrl?: string | null): Promise<string> {
  if (!rawUrl) return '';
  if (rawUrl.startsWith('data:') || rawUrl.startsWith('blob:')) return rawUrl;

  if (rawUrl.startsWith('storage:driver-documents/')) {
    const path = rawUrl.replace('storage:driver-documents/', '');
    const { data } = await supabase.storage
      .from('driver-documents')
      .createSignedUrl(path, 3600);
    if (data?.signedUrl) return data.signedUrl;
  }

  // Auto-heal legacy broken public URLs pointing to private driver-documents bucket
  const legacyPrivateMarker = '/storage/v1/object/public/driver-documents/';
  const markerIdx = rawUrl.indexOf(legacyPrivateMarker);
  if (markerIdx !== -1) {
    const path = rawUrl.slice(markerIdx + legacyPrivateMarker.length).split('?')[0];
    if (path) {
      const { data } = await supabase.storage
        .from('driver-documents')
        .createSignedUrl(path, 3600);
      if (data?.signedUrl) return data.signedUrl;
    }
  }

  return rawUrl;
}

export async function fetchUserProfileById(userId: string): Promise<UserProfile | null> {
  const { data: prof, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle();

  if (error || !prof) return null;
  if (prof.is_anonymized) return null;

  let driverRow: Record<string, unknown> | null = null;
  if (prof.role === 'driver') {
    const { data: drv } = await supabase
      .from('driver_profiles')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();
    driverRow = drv as Record<string, unknown> | null;
  }
  return mapDbProfile(prof as Record<string, unknown>, driverRow);
}

export async function restoreSessionUser(): Promise<UserProfile | null> {
  const { data } = await supabase.auth.getSession();
  const uid = data.session?.user?.id;
  if (!uid) return null;
  return fetchUserProfileById(uid);
}

export async function verifyMyAdminAccess(): Promise<boolean> {
  try {
    const { data: sessionData } = await supabase.auth.getSession();
    const uid = sessionData.session?.user?.id;
    if (!uid) return false;

    const { data: rpcRows, error: rpcErr } = await supabase.rpc('check_my_admin_access');
    if (!rpcErr && Array.isArray(rpcRows) && rpcRows.length > 0) {
      const row = rpcRows[0] as { is_admin?: boolean; role?: string; status?: string };
      return Boolean(row.is_admin) && row.status === 'active';
    }

    const { data: prof, error: profErr } = await supabase
      .from('profiles')
      .select('role,is_admin,status,is_anonymized')
      .eq('id', uid)
      .maybeSingle();

    if (!profErr && prof) {
      return (
        (Boolean(prof.is_admin) || prof.role === 'admin') &&
        prof.status === 'active' &&
        !prof.is_anonymized
      );
    }
    return false;
  } catch {
    return false;
  }
}

function translateAuthError(msg: string): string {
  const lower = msg.toLowerCase();
  if (lower.includes('invalid login credentials')) return 'E-mail ou senha incorretos.';
  if (lower.includes('email not confirmed')) {
    return 'E-mail pendente de confirmação. Verifique sua caixa de entrada ou desative "Confirm email" no Supabase Auth.';
  }
  if (lower.includes('user already registered')) {
    return 'Este e-mail já está cadastrado. Entre na aba "Entrar na conta".';
  }
  if (lower.includes('password should be at least')) {
    return 'A senha precisa ter pelo menos 6 caracteres.';
  }
  if (lower.includes('rate limit')) {
    return 'Muitas tentativas seguidas. Aguarde alguns segundos e tente novamente.';
  }
  return msg;
}

export async function loginUser(email: string, password: string): Promise<UserProfile> {
  const cleanEmail = email.trim().toLowerCase();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: cleanEmail,
    password,
  });

  if (error || !data.user) {
    throw new Error(translateAuthError(error?.message || 'Erro ao fazer login.'));
  }

  let profile = await fetchUserProfileById(data.user.id);
  if (!profile) {
    const meta = (data.user.user_metadata || {}) as Record<string, unknown>;
    const inferredRole = meta.role === 'driver' ? 'driver' : 'passenger';
    const inferredStatus = inferredRole === 'driver' ? 'pending' : 'active';

    await supabase.from('profiles').upsert({
      id: data.user.id,
      role: inferredRole,
      status: inferredStatus,
      full_name: String(meta.full_name || cleanEmail.split('@')[0]),
      phone: String(meta.phone || ''),
      email: cleanEmail,
      cpf: String(meta.cpf || ''),
      preferred_payment: 'pix',
    });

    profile = await fetchUserProfileById(data.user.id);
  }

  if (!profile || profile.is_anonymized) {
    await supabase.auth.signOut();
    throw new Error('Conta encerrada ou perfil indisponível.');
  }

  return profile;
}

export interface RegisterPayload {
  role: 'passenger' | 'driver';
  full_name: string;
  phone: string;
  email: string;
  cpf: string;
  password: string;
  cnh_url?: string;
  crlv_url?: string;
  vehicle_type?: 'car' | 'moto' | 'delivery';
  vehicle_model?: string;
  vehicle_plate?: string;
  vehicle_color?: string;
  pix_key?: string;
}

export async function registerUser(payload: RegisterPayload): Promise<{
  user?: UserProfile;
  pendingEmailConfirmation?: boolean;
}> {
  const cleanEmail = payload.email.trim().toLowerCase();
  const effectiveRole: 'passenger' | 'driver' =
    payload.role === 'driver' ? 'driver' : 'passenger';
  const effectiveStatus: UserProfile['status'] =
    effectiveRole === 'passenger' ? 'active' : 'pending';

  const { data, error } = await supabase.auth.signUp({
    email: cleanEmail,
    password: payload.password,
    options: {
      data: {
        role: effectiveRole,
        full_name: payload.full_name.trim(),
        phone: payload.phone.trim(),
        cpf: payload.cpf.trim(),
      },
    },
  });

  if (error || !data.user) {
    throw new Error(translateAuthError(error?.message || 'Não foi possível criar sua conta.'));
  }

  const userId = data.user.id;
  let session = data.session;

  if (!session) {
    // Try immediate sign in in case email confirmation is optional
    const signInAttempt = await supabase.auth.signInWithPassword({
      email: cleanEmail,
      password: payload.password,
    });
    session = signInAttempt.data.session;
  }

  if (!session) {
    return { pendingEmailConfirmation: true };
  }

  const { error: profErr } = await supabase.from('profiles').upsert({
    id: userId,
    role: effectiveRole,
    status: effectiveStatus,
    full_name: payload.full_name.trim(),
    phone: payload.phone.trim(),
    email: cleanEmail,
    cpf: payload.cpf.trim(),
    preferred_payment: 'pix',
  });

  if (profErr) {
    throw new Error(`Erro ao salvar perfil: ${profErr.message}`);
  }

  if (effectiveRole === 'driver') {
    const cnhStored = await uploadDriverDocOrFallback(
      userId,
      'cnh',
      payload.cnh_url || ''
    );
    const crlvStored = await uploadDriverDocOrFallback(
      userId,
      'crlv',
      payload.crlv_url || ''
    );

    const initialVehicle: DriverVehicle = {
      id: 'veh-1',
      vehicle_type: payload.vehicle_type || 'car',
      vehicle_model: (payload.vehicle_model || '').trim(),
      vehicle_plate: (payload.vehicle_plate || '').trim().toUpperCase(),
      vehicle_color: (payload.vehicle_color || '').trim(),
    };
    writeCachedDriverVehicles(userId, [initialVehicle], initialVehicle.id);

    const drvPayload: Record<string, unknown> = {
      user_id: userId,
      cnh_url: cnhStored,
      crlv_url: crlvStored,
      vehicle_type: initialVehicle.vehicle_type,
      vehicle_model: initialVehicle.vehicle_model,
      vehicle_plate: initialVehicle.vehicle_plate,
      vehicle_color: initialVehicle.vehicle_color,
      pix_key: (payload.pix_key || '').trim(),
      is_online: false,
      current_lat: -23.55052,
      current_lng: -46.633308,
      heading: 0,
      vehicles: [initialVehicle],
      active_vehicle_id: initialVehicle.id,
    };

    let { error: drvErr } = await supabase.from('driver_profiles').upsert(drvPayload);
    if (drvErr && (drvErr.code === '42703' || drvErr.code === 'PGRST204')) {
      delete drvPayload.vehicles;
      delete drvPayload.active_vehicle_id;
      const retry = await supabase.from('driver_profiles').upsert(drvPayload);
      drvErr = retry.error;
    }

    if (drvErr) {
      throw new Error(`Erro ao salvar veículo/documentos: ${drvErr.message}`);
    }
  }

  const profile = await fetchUserProfileById(userId);
  if (!profile) {
    throw new Error('Conta criada, mas não foi possível carregar seu perfil.');
  }

  return { user: profile };
}

export async function logoutUser(): Promise<void> {
  await supabase.auth.signOut();
}

function readCachedPlatformBrand(): Partial<PlatformConfig> {
  try {
    const raw = localStorage.getItem(PLATFORM_BRAND_CACHE_KEY);
    return raw ? (JSON.parse(raw) as Partial<PlatformConfig>) : {};
  } catch {
    return {};
  }
}

function resolveNormalizedBrandName(raw?: unknown): string {
  const clean = String(raw || '').trim();
  if (
    !clean ||
    clean === 'Boreal Mobilidade' ||
    clean === '66 Mobilidade' ||
    clean === 'Meia Meia' ||
    clean === 'Meia Meia Mobilidade' ||
    clean === 'Go Driver' ||
    clean === 'Velo99' ||
    clean === 'Velo99 Mobilidade'
  ) {
    return DEFAULT_PLATFORM_CONFIG.site_name;
  }
  return clean;
}

function resolveNormalizedPrimaryColor(raw?: unknown): string {
  const clean = String(raw || '').trim();
  const upper = clean.toUpperCase();
  if (!clean || upper === '#047857' || upper === '#FFD100' || upper === '#FFDD00') {
    return DEFAULT_PLATFORM_CONFIG.primary_color || '#2563EB';
  }
  return clean;
}

function resolveNormalizedSecondaryColor(raw?: unknown): string {
  const clean = String(raw || '').trim();
  const upper = clean.toUpperCase();
  if (!clean || upper === '#0F2421' || upper === '#111827') {
    return DEFAULT_PLATFORM_CONFIG.secondary_color || '#0F172A';
  }
  return clean;
}

export async function fetchAppBrandConfig(): Promise<{
  app_name: string;
  logo_url: string | null;
  primary_color: string;
  secondary_color: string;
}> {
  const cached = readCachedPlatformBrand();
  const [{ data: appCfg }, { data: platCfg }] = await Promise.all([
    supabase.from('configuracoes_app').select('*').eq('id', 1).maybeSingle(),
    supabase.from('platform_settings').select('*').eq('id', 1).maybeSingle(),
  ]);

  const rawLogo =
    (appCfg?.logo_url as string | null | undefined) ??
    (platCfg?.app_logo_url as string | null | undefined) ??
    cached.app_logo_url ??
    null;

  const resolvedLogo = rawLogo ? await resolveDocumentDisplayUrl(rawLogo) : null;

  return {
    app_name: resolveNormalizedBrandName(
      appCfg?.app_name || platCfg?.site_name || cached.site_name
    ),
    logo_url: resolvedLogo || rawLogo,
    primary_color: resolveNormalizedPrimaryColor(
      appCfg?.primary_color || platCfg?.primary_color || cached.primary_color
    ),
    secondary_color: resolveNormalizedSecondaryColor(
      appCfg?.secondary_color || platCfg?.secondary_color || cached.secondary_color
    ),
  };
}

export async function fetchPlatformConfig(): Promise<PlatformConfig> {
  const [{ data, error }, { data: appCfg }] = await Promise.all([
    supabase.from('platform_settings').select('*').eq('id', 1).maybeSingle(),
    supabase.from('configuracoes_app').select('*').eq('id', 1).maybeSingle(),
  ]);

  const cached = readCachedPlatformBrand();
  if (error || !data) {
    const fallbackLogo =
      (appCfg?.logo_url as string | null | undefined) ?? cached.app_logo_url ?? null;
    const resolvedFallbackLogo = fallbackLogo
      ? await resolveDocumentDisplayUrl(fallbackLogo)
      : null;
    const resolvedFallbackQr = cached.platform_pix_qr_url
      ? await resolveDocumentDisplayUrl(cached.platform_pix_qr_url)
      : null;
    return {
      ...DEFAULT_PLATFORM_CONFIG,
      ...cached,
      site_name: resolveNormalizedBrandName(appCfg?.app_name || cached.site_name),
      app_logo_url: resolvedFallbackLogo,
      platform_pix_qr_url: resolvedFallbackQr,
      primary_color: resolveNormalizedPrimaryColor(appCfg?.primary_color || cached.primary_color),
      secondary_color: resolveNormalizedSecondaryColor(appCfg?.secondary_color || cached.secondary_color),
      ota_web_url: cached.ota_web_url ?? null,
    };
  }

  const rawQrUrl =
    (data.platform_pix_qr_url as string | null | undefined) ??
    cached.platform_pix_qr_url ??
    null;
  const rawLogoUrl =
    (appCfg?.logo_url as string | null | undefined) ??
    (data.app_logo_url as string | null | undefined) ??
    cached.app_logo_url ??
    null;
  const [resolvedQrUrl, resolvedLogoUrl] = await Promise.all([
    rawQrUrl ? resolveDocumentDisplayUrl(rawQrUrl) : Promise.resolve(null),
    rawLogoUrl ? resolveDocumentDisplayUrl(rawLogoUrl) : Promise.resolve(null),
  ]);

  return {
    platform_pix_key: String(data.platform_pix_key || DEFAULT_PLATFORM_CONFIG.platform_pix_key),
    platform_pix_receiver: String(
      data.platform_pix_receiver || DEFAULT_PLATFORM_CONFIG.platform_pix_receiver
    ),
    platform_city: String(data.platform_city || DEFAULT_PLATFORM_CONFIG.platform_city),
    company_address:
      (data.company_address as string | null | undefined) ?? cached.company_address ?? '',
    platform_pix_qr_url: resolvedQrUrl || null,
    site_name: resolveNormalizedBrandName(
      appCfg?.app_name || data.site_name || cached.site_name
    ),
    support_whatsapp: String(data.support_whatsapp || cached.support_whatsapp || ''),
    commission_percent: Number(data.commission_percent ?? cached.commission_percent ?? 0),
    maintenance_mode: Boolean(data.maintenance_mode ?? false),
    app_logo_url: resolvedLogoUrl || null,
    primary_color: resolveNormalizedPrimaryColor(
      appCfg?.primary_color || data.primary_color || cached.primary_color
    ),
    secondary_color: resolveNormalizedSecondaryColor(
      appCfg?.secondary_color || data.secondary_color || cached.secondary_color
    ),
    vehicle_img_moto:
      (data.vehicle_img_moto as string | null | undefined) ?? cached.vehicle_img_moto ?? null,
    vehicle_img_pop:
      (data.vehicle_img_pop as string | null | undefined) ?? cached.vehicle_img_pop ?? null,
    vehicle_img_delivery_moto:
      (data.vehicle_img_delivery_moto as string | null | undefined) ??
      cached.vehicle_img_delivery_moto ??
      null,
    vehicle_img_delivery_car:
      (data.vehicle_img_delivery_car as string | null | undefined) ??
      cached.vehicle_img_delivery_car ??
      null,
    sound_offer_url:
      (data.sound_offer_url as string | null | undefined) ?? cached.sound_offer_url ?? null,
    sound_delivery_url:
      (data.sound_delivery_url as string | null | undefined) ?? cached.sound_delivery_url ?? null,
    sound_accepted_url:
      (data.sound_accepted_url as string | null | undefined) ?? cached.sound_accepted_url ?? null,
    sound_arrived_url:
      (data.sound_arrived_url as string | null | undefined) ?? cached.sound_arrived_url ?? null,
    sound_completed_url:
      (data.sound_completed_url as string | null | undefined) ?? cached.sound_completed_url ?? null,
    sound_chat_url:
      (data.sound_chat_url as string | null | undefined) ?? cached.sound_chat_url ?? null,
    sound_cancel_url:
      (data.sound_cancel_url as string | null | undefined) ?? cached.sound_cancel_url ?? null,
    ota_latest_version:
      (data.ota_latest_version as string | null | undefined) ?? cached.ota_latest_version ?? '1.2.2',
    ota_apk_url:
      (data.ota_apk_url as string | null | undefined) ?? cached.ota_apk_url ?? null,
    ota_web_url:
      (data.ota_web_url as string | null | undefined) ?? cached.ota_web_url ?? null,
    ota_release_notes:
      (data.ota_release_notes as string | null | undefined) ?? cached.ota_release_notes ?? null,
    deposit_window_enabled:
      data.deposit_window_enabled === undefined
        ? cached.deposit_window_enabled ?? true
        : Boolean(data.deposit_window_enabled),
    deposit_start_time: normalizeHHMM(
      (data.deposit_start_time as string | null | undefined) ?? cached.deposit_start_time,
      '07:00'
    ),
    deposit_end_time: normalizeHHMM(
      (data.deposit_end_time as string | null | undefined) ?? cached.deposit_end_time,
      '23:30'
    ),
  };
}

export async function fetchPricingList(): Promise<PricingSetting[]> {
  const { data, error } = await supabase.from('pricing_settings').select('*');
  if (error || !data || data.length === 0) return DEFAULT_PRICING_LIST;

  const byCat = new Map<string, PricingSetting>();
  for (const row of data) {
    const cat = String(row.category);
    byCat.set(cat, {
      category: cat as RideCategory,
      label: String(row.label),
      description: String(row.description),
      base_fare: Number(row.base_fare),
      per_km_rate: Number(row.per_km_rate),
      min_fare: Number(row.min_fare),
      active: Boolean(row.active ?? true),
    });
  }

  return DEFAULT_PRICING_LIST.map((def) => byCat.get(def.category) ?? def);
}

export async function fetchOnlineDriversPublic(): Promise<UserProfile[]> {
  // Try secure public RPC first
  const { data: rpcData, error: rpcErr } = await supabase.rpc('get_online_drivers_public');
  if (!rpcErr && Array.isArray(rpcData)) {
    return rpcData.map((d: Record<string, unknown>) => ({
      id: String(d.id),
      role: 'driver',
      status: 'active',
      full_name: String(d.full_name || 'Motorista'),
      phone: '',
      email: '',
      cpf: '',
      avatar_url: d.avatar_url ? String(d.avatar_url) : null,
      rating_avg: Number(d.rating_avg ?? 5),
      rating_count: 0,
      wallet_balance: 0,
      created_at: '',
      driver: {
        user_id: String(d.id),
        cnh_url: '',
        crlv_url: '',
        vehicle_type: (d.vehicle_type as 'car' | 'moto' | 'delivery') || 'car',
        vehicle_model: String(d.vehicle_model || ''),
        vehicle_plate: '***-****',
        vehicle_color: String(d.vehicle_color || ''),
        pix_key: '',
        is_online: true,
        current_lat: typeof d.current_lat === 'number' ? d.current_lat : null,
        current_lng: typeof d.current_lng === 'number' ? d.current_lng : null,
        heading: Number(d.heading ?? 0),
        acceptance_rate: 100,
        completion_rate: 100,
        updated_at: '',
      },
    }));
  }

  // Fallback direct query (for admin or active rides)
  const { data } = await supabase
    .from('driver_profiles')
    .select('*')
    .eq('is_online', true);

  if (!data) return [];
  return data.map((row) => ({
    id: String(row.user_id),
    role: 'driver',
    status: 'active',
    full_name: 'Motorista Online',
    phone: '',
    email: '',
    cpf: '',
    rating_avg: 5,
    rating_count: 0,
    wallet_balance: 0,
    created_at: '',
    driver: mapDbDriver(row as Record<string, unknown>),
  }));
}

async function resolveMissingPassengerPreviews(
  rideRows: Array<Record<string, unknown>>,
  profilesById: Map<string, UserProfile>
): Promise<void> {
  const missingRides = rideRows.filter((r) => {
    const pid = r.passenger_id ? String(r.passenger_id) : '';
    return pid && !profilesById.has(pid);
  });

  if (missingRides.length > 0) {
    await Promise.all(
      missingRides.slice(0, 12).map(async (r) => {
        const pid = String(r.passenger_id);
        if (profilesById.has(pid)) return;
        try {
          const { data } = await supabase.rpc('get_ride_passenger_preview', {
            p_ride_id: String(r.id),
          });
          const row = Array.isArray(data) ? data[0] : data;
          if (row && row.id) {
            const rawAvatar = row.avatar_url ? String(row.avatar_url) : null;
            const resolvedAvatar = rawAvatar
              ? await resolveDocumentDisplayUrl(rawAvatar).catch(() => rawAvatar)
              : null;
            profilesById.set(
              String(row.id),
              mapDbProfile({
                id: row.id,
                role: 'passenger',
                status: row.status || 'active',
                full_name: row.full_name || 'Passageiro',
                avatar_url: resolvedAvatar,
                rating_avg: row.rating_avg ?? 5,
                rating_count: row.rating_count ?? 0,
              })
            );
          }
        } catch {
          // Ignore if RPC not yet installed
        }
      })
    );
  }

  await Promise.all(
    Array.from(profilesById.values()).map(async (prof) => {
      if (
        prof.avatar_url &&
        (prof.avatar_url.startsWith('storage:') ||
          prof.avatar_url.includes('/storage/v1/object/public/driver-documents/'))
      ) {
        prof.avatar_url = await resolveDocumentDisplayUrl(prof.avatar_url).catch(
          () => prof.avatar_url || null
        );
      }
    })
  );
}

export async function fetchEnrichedRides(): Promise<Ride[]> {
  const { data: rideRows, error } = await supabase
    .from('rides')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(150);

  if (error || !rideRows) return [];

  const userIds = new Set<string>();
  for (const r of rideRows) {
    if (r.passenger_id) userIds.add(String(r.passenger_id));
    if (r.driver_id) userIds.add(String(r.driver_id));
  }

  const profilesById = new Map<string, UserProfile>();
  if (userIds.size > 0) {
    const idList = Array.from(userIds);
    const { data: profs } = await supabase.from('profiles').select('*').in('id', idList);
    const { data: drvs } = await supabase
      .from('driver_profiles')
      .select('*')
      .in('user_id', idList);

    const drvMap = new Map<string, Record<string, unknown>>();
    for (const d of drvs || []) {
      drvMap.set(String(d.user_id), d as Record<string, unknown>);
    }
    for (const p of profs || []) {
      const uid = String(p.id);
      profilesById.set(uid, mapDbProfile(p as Record<string, unknown>, drvMap.get(uid)));
    }
  }

  await resolveMissingPassengerPreviews(rideRows as Array<Record<string, unknown>>, profilesById);

  return rideRows.map((r) => mapDbRide(r as Record<string, unknown>, profilesById));
}

export async function fetchRideByIdEnriched(rideId: string): Promise<Ride | null> {
  const { data: row, error } = await supabase
    .from('rides')
    .select('*')
    .eq('id', rideId)
    .maybeSingle();

  if (error || !row) return null;

  const profilesById = new Map<string, UserProfile>();
  const ids = [row.passenger_id, row.driver_id].filter(Boolean) as string[];
  if (ids.length > 0) {
    const { data: profs } = await supabase.from('profiles').select('*').in('id', ids);
    const { data: drvs } = await supabase.from('driver_profiles').select('*').in('user_id', ids);
    const drvMap = new Map<string, Record<string, unknown>>();
    for (const d of drvs || []) drvMap.set(String(d.user_id), d as Record<string, unknown>);
    for (const p of profs || []) {
      profilesById.set(
        String(p.id),
        mapDbProfile(p as Record<string, unknown>, drvMap.get(String(p.id)))
      );
    }
  }

  await resolveMissingPassengerPreviews([row as Record<string, unknown>], profilesById);

  return mapDbRide(row as Record<string, unknown>, profilesById);
}

export async function createRideRequest(input: {
  passenger_id: string;
  category: RideCategory;
  payment_method: PaymentMethod;
  origin: GeoPoint;
  destination: GeoPoint;
  distance_km: number;
  estimated_fare: number;
  negotiated_fare?: number | null;
  delivery_notes?: string | null;
  require_pin?: boolean;
  pending_debt_included?: number;
  coupon_id?: string | null;
  user_coupon_id?: string | null;
  discount_amount?: number;
}): Promise<Ride> {
  const fareRounded = Number(input.estimated_fare.toFixed(2));
  let precheckWalletBalance = 0;

  if (input.payment_method === 'wallet') {
    const { data: prof } = await supabase
      .from('profiles')
      .select('wallet_balance')
      .eq('id', input.passenger_id)
      .maybeSingle();
    precheckWalletBalance = Number(prof?.wallet_balance ?? 0);
    if (precheckWalletBalance < fareRounded) {
      throw new Error(
        `Saldo insuficiente na carteira (${precheckWalletBalance.toFixed(2)}). Deposite via Pix ou escolha Pix/Dinheiro.`
      );
    }
  }

  const pin = String(Math.floor(1000 + Math.random() * 9000));
  const payload = {
    passenger_id: input.passenger_id,
    category: input.category,
    payment_method: input.payment_method,
    payment_status: 'pending',
    status: 'searching',
    origin_address: input.origin.address,
    origin_lat: input.origin.lat,
    origin_lng: input.origin.lng,
    destination_address: input.destination.address,
    destination_lat: input.destination.lat,
    destination_lng: input.destination.lng,
    distance_km: input.distance_km,
    estimated_fare: fareRounded,
    negotiated_fare: input.negotiated_fare ?? null,
    pin_code: pin,
    require_pin: input.require_pin ?? true,
    pending_debt_included: Number(input.pending_debt_included ?? 0),
    delivery_notes: input.delivery_notes || null,
    coupon_id: input.coupon_id ?? null,
    user_coupon_id: input.user_coupon_id ?? null,
    discount_amount: Number((input.discount_amount ?? 0).toFixed(2)),
  };

  let { data, error } = await supabase
    .from('rides')
    .insert(payload)
    .select('*')
    .single();

  if (
    error &&
    (error.code === '42703' ||
      error.message.includes('category') ||
      error.message.includes('require_pin') ||
      error.message.includes('pending_debt_included') ||
      error.message.includes('delivery_notes') ||
      error.message.includes('negotiated_fare') ||
      error.message.includes('coupon_id') ||
      error.message.includes('user_coupon_id') ||
      error.message.includes('discount_amount'))
  ) {
    // Fallback if optional incremental columns haven't been executed yet on Supabase
    const legacyCategory =
      input.category === 'delivery_moto' || input.category === 'delivery_car'
        ? 'delivery'
        : input.category === 'negocia'
        ? 'pop'
        : input.category;
    const legacyRes = await supabase
      .from('rides')
      .insert({
        passenger_id: input.passenger_id,
        category: error.message.includes('category') ? legacyCategory : input.category,
        payment_method: input.payment_method,
        payment_status: 'pending',
        status: 'searching',
        origin_address: input.origin.address,
        origin_lat: input.origin.lat,
        origin_lng: input.origin.lng,
        destination_address: input.destination.address,
        destination_lat: input.destination.lat,
        destination_lng: input.destination.lng,
        distance_km: input.distance_km,
        estimated_fare: fareRounded,
        pin_code: pin,
      })
      .select('*')
      .single();
    data = legacyRes.data;
    error = legacyRes.error;
  }

  if (error || !data) {
    if (error?.code === '23514' || error?.message?.includes('check constraint')) {
      throw new Error(
        'Atualize o SQL do Supabase (aba Admin > SQL & APK) para habilitar o pagamento com Saldo do App.'
      );
    }
    throw new Error(error?.message || 'Erro ao registrar corrida no Supabase.');
  }

  const rideId = String(data.id);

  if (input.payment_method === 'wallet') {
    const desc = `Reserva GoPay corrida #${rideId.slice(-4)} · ${
      input.destination.address.split(',')[0]
    }`;
    const { error: reserveErr } = await supabase.rpc('reserve_66pay_for_ride', {
      p_ride_id: rideId,
      p_amount: fareRounded,
      p_description: desc,
    });

    if (reserveErr) {
      if (reserveErr.message?.toLowerCase().includes('saldo')) {
        await supabase.from('rides').delete().eq('id', rideId);
        throw new Error('Saldo GoPay insuficiente na carteira.');
      }
      // Fallback for older SQL schemas without reserve_66pay_for_ride: use debit_own_wallet_for_ride & mark paid_wallet
      const { error: rpcErr } = await supabase.rpc('debit_own_wallet_for_ride', {
        p_ride_id: rideId,
        p_amount: fareRounded,
        p_description: desc,
      });
      if (rpcErr) {
        if (rpcErr.message?.toLowerCase().includes('saldo insuficiente')) {
          await supabase.from('rides').delete().eq('id', rideId);
          throw new Error('Saldo insuficiente na carteira.');
        }
        const { data: freshProf } = await supabase
          .from('profiles')
          .select('wallet_balance')
          .eq('id', input.passenger_id)
          .maybeSingle();
        const bal = Number(freshProf?.wallet_balance ?? precheckWalletBalance);
        if (bal < fareRounded) {
          await supabase.from('rides').delete().eq('id', rideId);
          throw new Error('Saldo insuficiente na carteira.');
        }
        const nextBal = Number((bal - fareRounded).toFixed(2));
        const { error: updErr } = await supabase
          .from('profiles')
          .update({ wallet_balance: nextBal, updated_at: new Date().toISOString() })
          .eq('id', input.passenger_id);
        if (updErr) {
          await supabase.from('rides').delete().eq('id', rideId);
          throw new Error(updErr.message);
        }
        await supabase
          .from('wallet_transactions')
          .insert({
            user_id: input.passenger_id,
            ride_id: rideId,
            amount: -fareRounded,
            type: 'ride_debit',
            description: desc,
          })
          .then(() => undefined, () => undefined);
      }
      await supabase
        .from('rides')
        .update({ payment_status: 'paid_wallet' })
        .eq('id', rideId);
      if (input.pending_debt_included && input.pending_debt_included > 0) {
        await clearPassengerIncludedDebtIfAny({
          id: rideId,
          passenger_id: input.passenger_id,
          pending_debt_included: input.pending_debt_included,
        } as Ride);
      }
    }
  }

  if (input.user_coupon_id) {
    const { error: redeemErr } = await supabase.rpc('redeem_user_coupon', {
      p_user_coupon_id: input.user_coupon_id,
      p_ride_id: rideId,
    });
    if (redeemErr) {
      await supabase
        .from('user_coupons')
        .update({
          status: 'used',
          used_ride_id: rideId,
          used_at: new Date().toISOString(),
        })
        .eq('id', input.user_coupon_id)
        .eq('user_id', input.passenger_id);
    }
  }

  return (await fetchRideByIdEnriched(rideId)) || mapDbRide(data as Record<string, unknown>);
}

export async function cancelRide(rideId: string): Promise<Ride | null> {
  const existing = await fetchRideByIdEnriched(rideId);

  const { error } = await supabase
    .from('rides')
    .update({ status: 'cancelled' })
    .eq('id', rideId);

  if (error) throw new Error(error.message);

  if (
    existing &&
    existing.status !== 'completed' &&
    existing.status !== 'cancelled' &&
    existing.payment_method === 'wallet' &&
    (existing.payment_status === 'paid_wallet' || existing.payment_status === 'paid')
  ) {
    const { error: rpcErr } = await supabase.rpc('refund_wallet_for_cancelled_ride', {
      p_ride_id: rideId,
    });
    if (rpcErr && existing.passenger_id) {
      const { data: already } = await supabase
        .from('wallet_transactions')
        .select('id')
        .eq('ride_id', rideId)
        .eq('user_id', existing.passenger_id)
        .eq('type', 'ride_refund')
        .maybeSingle();
      if (!already) {
        const refund = Number((existing.final_fare ?? existing.estimated_fare).toFixed(2));
        const { data: prof } = await supabase
          .from('profiles')
          .select('wallet_balance')
          .eq('id', existing.passenger_id)
          .maybeSingle();
        const nextBal = Number((Number(prof?.wallet_balance ?? 0) + refund).toFixed(2));
        await supabase
          .from('profiles')
          .update({ wallet_balance: nextBal, updated_at: new Date().toISOString() })
          .eq('id', existing.passenger_id);
        await supabase.from('wallet_transactions').insert({
          user_id: existing.passenger_id,
          ride_id: rideId,
          amount: refund,
          type: 'ride_refund',
          description: `Estorno de corrida cancelada #${rideId.slice(-4)}`,
        });
      }
    }
  }

  return fetchRideByIdEnriched(rideId);
}

export interface CancellationFeeEstimate {
  canCancel: boolean;
  isFreeGrace: boolean;
  remainingFreeSec: number;
  elapsedSinceAcceptSec: number;
  feeAmount: number;
  maxFeeCap: number;
  reasonLabel: string;
}

export function computeCancellationFeeEstimate(
  ride: Ride,
  _driverCoords?: [number, number] | null
): CancellationFeeEstimate {
  if (
    ride.status === 'in_progress' ||
    ride.status === 'completed' ||
    ride.status === 'cancelled'
  ) {
    return {
      canCancel: false,
      isFreeGrace: false,
      remainingFreeSec: 0,
      elapsedSinceAcceptSec: 0,
      feeAmount: 0,
      maxFeeCap: 0,
      reasonLabel:
        ride.status === 'in_progress'
          ? 'Não é possível cancelar após o embarque iniciado.'
          : 'Solicitação já encerrada.',
    };
  }

  if (ride.status === 'searching' || !ride.accepted_at) {
    return {
      canCancel: true,
      isFreeGrace: true,
      remainingFreeSec: 20,
      elapsedSinceAcceptSec: 0,
      feeAmount: 0,
      maxFeeCap: 0,
      reasonLabel: 'Cancelamento gratuito enquanto procuramos um parceiro.',
    };
  }

  const fare = Number((ride.final_fare ?? ride.estimated_fare ?? 0).toFixed(2));
  const acceptedMs = new Date(ride.accepted_at).getTime();
  const elapsedSec = Number.isFinite(acceptedMs)
    ? Math.max(0, Math.floor((Date.now() - acceptedMs) / 1000))
    : 0;

  if (ride.status === 'arrived') {
    return {
      canCancel: true,
      isFreeGrace: false,
      remainingFreeSec: 0,
      elapsedSinceAcceptSec: elapsedSec,
      feeAmount: fare,
      maxFeeCap: fare,
      reasonLabel:
        'O motorista/entregador já chegou ao local de embarque. Cancelar agora cobra 100% do valor da corrida.',
    };
  }

  if (elapsedSec <= 20) {
    return {
      canCancel: true,
      isFreeGrace: true,
      remainingFreeSec: 20 - elapsedSec,
      elapsedSinceAcceptSec: elapsedSec,
      feeAmount: 0,
      maxFeeCap: fare,
      reasonLabel: `Você está nos 20 segundos gratuitos após o aceite (${20 - elapsedSec}s restantes).`,
    };
  }

  const fixedLateFee = Number(Math.min(fare, 3.0).toFixed(2));
  return {
    canCancel: true,
    isFreeGrace: false,
    remainingFreeSec: 0,
    elapsedSinceAcceptSec: elapsedSec,
    feeAmount: fixedLateFee,
    maxFeeCap: fare,
    reasonLabel:
      'Prazo gratuito de 20s encerrado · Taxa fixa de R$ 3,00 repassada ao motorista/entregador.',
  };
}

export async function cancelRideWithPolicy(
  ride: Ride,
  driverCoords?: [number, number] | null
): Promise<Ride | null> {
  if (ride.status === 'in_progress') {
    throw new Error('Não é possível cancelar uma corrida ou entrega depois que o embarque já foi iniciado.');
  }

  const estimate = computeCancellationFeeEstimate(ride, driverCoords);
  const { error: rpcErr } = await supabase.rpc('cancel_ride_with_fee', {
    p_ride_id: ride.id,
    p_fee_amount: estimate.feeAmount,
  });

  if (!rpcErr) {
    return fetchRideByIdEnriched(ride.id);
  }

  // Fallback to legacy cancellation if incremental RPC is not yet installed in Supabase
  return cancelRide(ride.id);
}

export async function toggleDriverOnlineStatus(
  userId: string,
  nextOnline: boolean,
  lat: number,
  lng: number
): Promise<UserProfile> {
  const { error } = await supabase
    .from('driver_profiles')
    .update({
      is_online: nextOnline,
      current_lat: lat,
      current_lng: lng,
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', userId);

  if (error) throw new Error(error.message);
  const updated = await fetchUserProfileById(userId);
  if (!updated) throw new Error('Perfil não encontrado.');
  return updated;
}

export async function pushDriverLocation(
  userId: string,
  lat: number,
  lng: number,
  heading = 0
): Promise<void> {
  await supabase
    .from('driver_profiles')
    .update({
      current_lat: lat,
      current_lng: lng,
      heading,
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', userId);
}

export async function acceptRide(rideId: string, driverId: string): Promise<Ride> {
  const { data, error } = await supabase
    .from('rides')
    .update({
      driver_id: driverId,
      status: 'accepted',
      accepted_at: new Date().toISOString(),
    })
    .eq('id', rideId)
    .eq('status', 'searching')
    .select('id')
    .maybeSingle();

  if (error || !data) {
    throw new Error(error?.message || 'Esta solicitação já foi aceita ou cancelada.');
  }

  const enriched = await fetchRideByIdEnriched(rideId);
  if (!enriched) throw new Error('Corrida não encontrada.');
  return enriched;
}

export async function markRideArrived(rideId: string): Promise<Ride> {
  const { error } = await supabase
    .from('rides')
    .update({
      status: 'arrived',
      arrived_at: new Date().toISOString(),
    })
    .eq('id', rideId);

  if (error) throw new Error(error.message);
  const enriched = await fetchRideByIdEnriched(rideId);
  if (!enriched) throw new Error('Corrida não encontrada.');
  return enriched;
}

export async function startRideWithPin(
  ride: Ride,
  pinInput?: string
): Promise<Ride> {
  const isDelivery = ride.category === 'delivery_moto' || ride.category === 'delivery_car';
  const mustCheckPin = !isDelivery || ride.require_pin !== false;

  if (mustCheckPin && (pinInput || '').trim() !== ride.pin_code) {
    throw new Error(
      isDelivery
        ? 'PIN de coleta incorreto. Confirme os 4 dígitos com o remetente.'
        : 'Código PIN incorreto. Confirme os 4 dígitos com o passageiro.'
    );
  }

  const { error } = await supabase
    .from('rides')
    .update({
      status: 'in_progress',
      started_at: new Date().toISOString(),
    })
    .eq('id', ride.id);

  if (error) throw new Error(error.message);
  const enriched = await fetchRideByIdEnriched(ride.id);
  if (!enriched) throw new Error('Corrida não encontrada.');
  return enriched;
}

async function clearPassengerIncludedDebtIfAny(ride: Ride) {
  if (!ride.passenger_id || !ride.pending_debt_included || ride.pending_debt_included <= 0) return;
  try {
    const { data: prof } = await supabase
      .from('profiles')
      .select('pending_debt_amount')
      .eq('id', ride.passenger_id)
      .maybeSingle();
    const currentDebt = Number(prof?.pending_debt_amount ?? 0);
    if (currentDebt > 0) {
      const nextDebt = Number(Math.max(0, currentDebt - ride.pending_debt_included).toFixed(2));
      await supabase
        .from('profiles')
        .update({
          pending_debt_amount: nextDebt,
          pending_debt_note: nextDebt === 0 ? null : undefined,
          updated_at: new Date().toISOString(),
        })
        .eq('id', ride.passenger_id);
    }
  } catch {
    // Ignore if pending_debt_amount column hasn't been migrated yet
  }
}

async function creditDriverForPixRideIdempotent(
  driverId: string,
  rideId: string,
  amount: number,
  description: string,
  type: 'ride_earning' | 'dispute_settlement' = 'ride_earning'
) {
  const { error: rpcErr } = await supabase.rpc('credit_driver_wallet_for_ride', {
    p_ride_id: rideId,
    p_description: description,
    p_type: type,
  });

  if (!rpcErr) return;

  const { data: existing } = await supabase
    .from('wallet_transactions')
    .select('id')
    .eq('ride_id', rideId)
    .eq('user_id', driverId)
    .in('type', ['ride_earning', 'dispute_settlement'])
    .maybeSingle();

  if (existing) return;

  await supabase.from('wallet_transactions').insert({
    user_id: driverId,
    ride_id: rideId,
    amount,
    type,
    description,
  });

  const { data: prof } = await supabase
    .from('profiles')
    .select('wallet_balance')
    .eq('id', driverId)
    .maybeSingle();

  const currentBal = Number(prof?.wallet_balance ?? 0);
  await supabase
    .from('profiles')
    .update({
      wallet_balance: Number((currentBal + amount).toFixed(2)),
      updated_at: new Date().toISOString(),
    })
    .eq('id', driverId);
}

export async function completeRide(
  ride: Ride,
  driverId: string,
  pinInput?: string,
  overrideFinalFare?: number
): Promise<Ride> {
  const isDelivery = ride.category === 'delivery_moto' || ride.category === 'delivery_car';
  const mustVerifyDeliveryPin = isDelivery && ride.require_pin !== false;
  if (mustVerifyDeliveryPin && String(pinInput || '').trim() !== ride.pin_code) {
    throw new Error('Código PIN incorreto. Confirme os 4 dígitos no destino.');
  }

  const baseFare = overrideFinalFare ?? ride.final_fare ?? ride.estimated_fare;
  const finalFare = Number(baseFare.toFixed(2));
  const nextPaymentStatus: PaymentStatus =
    ride.payment_status === 'paid' ||
    ride.payment_status === 'paid_wallet' ||
    ride.payment_status === 'paid_pix' ||
    ride.payment_status === 'admin_settled'
      ? ride.payment_status
      : 'pending';

  const updatePayload: Record<string, unknown> = {
    status: 'completed',
    final_fare: finalFare,
    completed_at: new Date().toISOString(),
    payment_status: nextPaymentStatus,
  };

  let { error } = await supabase.from('rides').update(updatePayload).eq('id', ride.id);
  if (error && error.code === '42703') {
    const res2 = await supabase
      .from('rides')
      .update({
        status: 'completed',
        final_fare: finalFare,
        completed_at: new Date().toISOString(),
      })
      .eq('id', ride.id);
    error = res2.error;
  }

  if (error) throw new Error(error.message);

  if (
    (ride.payment_method === 'pix' && nextPaymentStatus === 'paid_pix') ||
    nextPaymentStatus === 'paid_wallet' ||
    nextPaymentStatus === 'paid'
  ) {
    const labelPrefix =
      nextPaymentStatus === 'paid' || nextPaymentStatus === 'paid_wallet'
        ? isDelivery
          ? 'Entrega GoPay'
          : 'Corrida GoPay'
        : isDelivery
        ? 'Entrega Pix'
        : 'Corrida Pix';

    await creditDriverForPixRideIdempotent(
      driverId,
      ride.id,
      finalFare,
      `${labelPrefix} #${ride.id.slice(-4)} · ${ride.destination_address.split(',')[0]}`
    );
  }

  const enriched = await fetchRideByIdEnriched(ride.id);
  if (!enriched) throw new Error('Corrida não encontrada.');
  return enriched;
}

export async function declarePixPaid(ride: Ride): Promise<Ride> {
  // Marks Pix as declared/sent by the customer — awaits Admin confirmation to unlock Driver checkout
  const { error } = await supabase
    .from('rides')
    .update({
      payment_method: 'pix',
      payment_status: ride.payment_status === 'paid_pix' ? 'paid_pix' : 'pending',
      pix_declared_at: new Date().toISOString(),
    })
    .eq('id', ride.id);

  if (error) throw new Error(error.message);
  const enriched = await fetchRideByIdEnriched(ride.id);
  if (!enriched) throw new Error('Corrida não encontrada.');
  return enriched;
}

export async function confirmCashReceived(ride: Ride): Promise<Ride> {
  const finalFare = Number((ride.final_fare ?? ride.estimated_fare).toFixed(2));
  const { error } = await supabase
    .from('rides')
    .update({
      payment_method: 'cash',
      payment_status: 'paid_cash',
      final_fare: finalFare,
    })
    .eq('id', ride.id);

  if (error && error.code !== '42703') {
    throw new Error(error.message);
  }
  await clearPassengerIncludedDebtIfAny(ride);
  const enriched = await fetchRideByIdEnriched(ride.id);
  if (!enriched) throw new Error('Corrida não encontrada.');
  return enriched;
}

export async function payCompletedRideWithWallet(ride: Ride): Promise<Ride> {
  const finalFare = Number((ride.final_fare ?? ride.estimated_fare).toFixed(2));

  const { error: rpcErr } = await supabase.rpc('pay_completed_ride_with_wallet', {
    p_ride_id: ride.id,
  });

  if (rpcErr) {
    if (
      rpcErr.message?.toLowerCase().includes('saldo insuficiente') ||
      rpcErr.message?.toLowerCase().includes('já foi quitada')
    ) {
      throw new Error(rpcErr.message);
    }

    // Fallback when RPC hasn't been deployed yet
    const { data: prof } = await supabase
      .from('profiles')
      .select('wallet_balance')
      .eq('id', ride.passenger_id)
      .maybeSingle();
    const bal = Number(prof?.wallet_balance ?? 0);
    if (bal < finalFare) {
      throw new Error(
        `Saldo insuficiente (${bal.toFixed(2)}). Deposite via Pix ou escolha Pix/Dinheiro.`
      );
    }

    const nextBal = Number((bal - finalFare).toFixed(2));
    const { error: updProfErr } = await supabase
      .from('profiles')
      .update({ wallet_balance: nextBal, updated_at: new Date().toISOString() })
      .eq('id', ride.passenger_id);
    if (updProfErr) throw new Error(updProfErr.message);

    const { error: rideUpdErr } = await supabase
      .from('rides')
      .update({
        payment_method: 'wallet',
        payment_status: 'paid_wallet',
        final_fare: finalFare,
      })
      .eq('id', ride.id);

    if (rideUpdErr) {
      // Restore balance if ride constraint rejected 'wallet'
      await supabase
        .from('profiles')
        .update({ wallet_balance: bal, updated_at: new Date().toISOString() })
        .eq('id', ride.passenger_id);
      if (rideUpdErr.code === '23514' || rideUpdErr.message?.includes('check constraint')) {
        throw new Error(
          'Aplique o SQL incremental na aba Admin > SQL & APK para habilitar pagamentos com Saldo do App.'
        );
      }
      throw new Error(rideUpdErr.message);
    }

    await supabase
      .from('wallet_transactions')
      .insert({
        user_id: ride.passenger_id,
        ride_id: ride.id,
        amount: -finalFare,
        type: 'ride_debit',
        description: `Pagamento pós-corrida Saldo do App #${ride.id.slice(-4)}`,
      })
      .then(() => undefined, () => undefined);

    if (ride.driver_id) {
      const isDelivery = ride.category === 'delivery_moto' || ride.category === 'delivery_car';
      await creditDriverForPixRideIdempotent(
        ride.driver_id,
        ride.id,
        finalFare,
        `${isDelivery ? 'Entrega Saldo App' : 'Corrida Saldo App'} #${ride.id.slice(-4)} · ${
          ride.destination_address.split(',')[0]
        }`
      ).catch(() => {});
    }

    await clearPassengerIncludedDebtIfAny(ride);
  }

  const enriched = await fetchRideByIdEnriched(ride.id);
  if (!enriched) throw new Error('Corrida não encontrada.');
  return enriched;
}

export async function switchCompletedRidePaymentMethod(
  rideId: string,
  method: 'pix' | 'cash'
): Promise<Ride> {
  const { error: rpcErr } = await supabase.rpc('client_select_ride_payment_method', {
    p_ride_id: rideId,
    p_method: method,
  });

  if (rpcErr) {
    const patch: Record<string, unknown> = { payment_method: method };
    if (method === 'cash') patch.pix_declared_at = null;
    const { error } = await supabase.from('rides').update(patch).eq('id', rideId);
    if (error) throw new Error(error.message);
  }

  const enriched = await fetchRideByIdEnriched(rideId);
  if (!enriched) throw new Error('Corrida não encontrada.');
  return enriched;
}

export async function reportRideUnpaid(rideId: string, reason: string): Promise<Ride> {
  const cleanReason =
    reason.trim() || 'Motorista informou que o passageiro não efetuou o pagamento.';
  const { error } = await supabase
    .from('rides')
    .update({
      payment_status: 'disputed',
      dispute_reason: cleanReason,
    })
    .eq('id', rideId);

  if (error) throw new Error(error.message);
  const enriched = await fetchRideByIdEnriched(rideId);
  if (!enriched) throw new Error('Corrida não encontrada.');
  return enriched;
}

export async function fetchWalletTransactions(userId: string): Promise<WalletTransaction[]> {
  const { data, error } = await supabase
    .from('wallet_transactions')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (error || !data) return [];
  return data.map((t) => ({
    id: String(t.id),
    user_id: String(t.user_id),
    ride_id: t.ride_id ? String(t.ride_id) : null,
    amount: Number(t.amount),
    type: t.type as WalletTransaction['type'],
    description: String(t.description),
    auth_code: t.auth_code ? String(t.auth_code) : null,
    sender_name: t.sender_name ? String(t.sender_name) : null,
    recipient_name: t.recipient_name ? String(t.recipient_name) : null,
    recipient_key: t.recipient_key ? String(t.recipient_key) : null,
    created_at: String(t.created_at),
  }));
}

export async function fetchRideMessages(rideId: string): Promise<RideMessage[]> {
  const { data, error } = await supabase
    .from('ride_messages')
    .select('*')
    .eq('ride_id', rideId)
    .order('created_at', { ascending: true });

  if (error || !data) return [];
  return data.map((m) => ({
    id: String(m.id),
    ride_id: String(m.ride_id),
    sender_id: String(m.sender_id),
    sender_name: String(m.sender_name),
    content: String(m.content),
    created_at: String(m.created_at),
  }));
}

export async function sendRideMessage(
  rideId: string,
  senderId: string,
  senderName: string,
  content: string
): Promise<RideMessage> {
  const { data, error } = await supabase
    .from('ride_messages')
    .insert({
      ride_id: rideId,
      sender_id: senderId,
      sender_name: senderName,
      content: content.trim(),
    })
    .select('*')
    .single();

  if (error || !data) throw new Error(error?.message || 'Erro ao enviar mensagem.');
  return {
    id: String(data.id),
    ride_id: String(data.ride_id),
    sender_id: String(data.sender_id),
    sender_name: String(data.sender_name),
    content: String(data.content),
    created_at: String(data.created_at),
  };
}

export async function submitRideRating(
  ride: Ride,
  fromUserId: string,
  toUserId: string,
  stars: number
): Promise<Ride> {
  const { error: rpcError } = await supabase.rpc('submit_ride_rating', {
    p_ride_id: ride.id,
    p_to_user_id: toUserId,
    p_stars: stars,
    p_comment: null,
  });

  if (rpcError) {
    // Fallback direct insert + flag update
    await supabase.from('ride_ratings').upsert({
      ride_id: ride.id,
      from_user_id: fromUserId,
      to_user_id: toUserId,
      stars,
    });
    const patch =
      fromUserId === ride.passenger_id
        ? { passenger_rating_submitted: true }
        : { driver_rating_submitted: true };
    await supabase.from('rides').update(patch).eq('id', ride.id);
  }

  return (await fetchRideByIdEnriched(ride.id)) || {
    ...ride,
    passenger_rating_submitted:
      fromUserId === ride.passenger_id ? true : ride.passenger_rating_submitted,
    driver_rating_submitted:
      fromUserId === ride.driver_id ? true : ride.driver_rating_submitted,
  };
}

export async function updateUserProfileSettings(
  currentUser: UserProfile,
  patch: {
    full_name: string;
    phone: string;
    email: string;
    avatar_url?: string | null;
    bio?: string | null;
    preferred_payment: PaymentMethod;
    home_address: SavedAddress | null;
    work_address: SavedAddress | null;
    favorites: SavedAddress[];
    vehicle_type?: 'car' | 'moto' | 'delivery';
    vehicle_model?: string;
    vehicle_plate?: string;
    vehicle_color?: string;
    pix_key?: string;
  }
): Promise<UserProfile> {
  let storedAvatar = patch.avatar_url !== undefined ? patch.avatar_url : currentUser.avatar_url;
  if (storedAvatar && storedAvatar.startsWith('data:')) {
    storedAvatar = await uploadUserAvatar(currentUser.id, storedAvatar);
  }

  const updateBody: Record<string, unknown> = {
    full_name: patch.full_name.trim(),
    phone: patch.phone.trim(),
    email: patch.email.trim().toLowerCase(),
    avatar_url: storedAvatar ?? null,
    bio: patch.bio !== undefined ? (patch.bio || '').trim() : currentUser.bio || null,
    preferred_payment: patch.preferred_payment,
    home_address: patch.home_address,
    work_address: patch.work_address,
    favorites: patch.favorites,
    updated_at: new Date().toISOString(),
  };

  let { error } = await supabase.from('profiles').update(updateBody).eq('id', currentUser.id);
  if (error && error.code === '42703') {
    delete updateBody.favorites;
    delete updateBody.bio;
    const retry = await supabase.from('profiles').update(updateBody).eq('id', currentUser.id);
    error = retry.error;
  }
  if (error) throw new Error(error.message);

  if (currentUser.role === 'driver' && currentUser.driver) {
    const nextType = patch.vehicle_type || currentUser.driver.vehicle_type;
    const nextModel = (patch.vehicle_model ?? currentUser.driver.vehicle_model).trim();
    const nextPlate = (patch.vehicle_plate ?? currentUser.driver.vehicle_plate)
      .trim()
      .toUpperCase();
    const nextColor = (patch.vehicle_color ?? currentUser.driver.vehicle_color).trim();
    const { vehicles: currentVehicles, activeVehicleId } = getDriverVehiclesList(currentUser);
    const updatedVehicles = currentVehicles.map((v) =>
      v.id === activeVehicleId
        ? {
            ...v,
            vehicle_type: nextType,
            vehicle_model: nextModel,
            vehicle_plate: nextPlate,
            vehicle_color: nextColor,
          }
        : v
    );
    writeCachedDriverVehicles(currentUser.id, updatedVehicles, activeVehicleId);

    const drvUpdate: Record<string, unknown> = {
      vehicle_type: nextType,
      vehicle_model: nextModel,
      vehicle_plate: nextPlate,
      vehicle_color: nextColor,
      pix_key: (patch.pix_key ?? currentUser.driver.pix_key).trim(),
      vehicles: updatedVehicles,
      active_vehicle_id: activeVehicleId,
      updated_at: new Date().toISOString(),
    };
    let { error: drvErr } = await supabase
      .from('driver_profiles')
      .update(drvUpdate)
      .eq('user_id', currentUser.id);
    if (drvErr && (drvErr.code === '42703' || drvErr.code === 'PGRST204')) {
      delete drvUpdate.vehicles;
      delete drvUpdate.active_vehicle_id;
      const retry = await supabase
        .from('driver_profiles')
        .update(drvUpdate)
        .eq('user_id', currentUser.id);
      drvErr = retry.error;
    }
    if (drvErr) throw new Error(drvErr.message);
  }

  const updated = await fetchUserProfileById(currentUser.id);
  if (!updated) throw new Error('Erro ao recarregar perfil.');
  return updated;
}

export function getDriverVehiclesList(user: UserProfile): {
  vehicles: DriverVehicle[];
  activeVehicleId: string;
} {
  const drv = user.driver;
  if (!drv) {
    return { vehicles: [], activeVehicleId: 'veh-1' };
  }
  if (drv.vehicles && drv.vehicles.length > 0) {
    const activeId =
      drv.active_vehicle_id && drv.vehicles.some((v) => v.id === drv.active_vehicle_id)
        ? drv.active_vehicle_id
        : drv.vehicles[0].id;
    return { vehicles: drv.vehicles, activeVehicleId: activeId };
  }
  const fallback: DriverVehicle = {
    id: 'veh-1',
    vehicle_type: drv.vehicle_type,
    vehicle_model: drv.vehicle_model,
    vehicle_plate: drv.vehicle_plate,
    vehicle_color: drv.vehicle_color,
  };
  return { vehicles: [fallback], activeVehicleId: fallback.id };
}

export async function saveDriverVehiclesAndSelect(
  userId: string,
  vehicles: DriverVehicle[],
  activeVehicleId: string,
  pixKey?: string
): Promise<UserProfile> {
  if (vehicles.length === 0) {
    throw new Error('É necessário manter pelo menos um veículo cadastrado.');
  }
  const cleaned = vehicles.map((v, idx) => ({
    id: v.id || `veh-${idx + 1}`,
    vehicle_type: v.vehicle_type,
    vehicle_model: v.vehicle_model.trim(),
    vehicle_plate: v.vehicle_plate.trim().toUpperCase(),
    vehicle_color: v.vehicle_color.trim(),
  }));
  const active = cleaned.find((v) => v.id === activeVehicleId) || cleaned[0];
  writeCachedDriverVehicles(userId, cleaned, active.id);

  const patch: Record<string, unknown> = {
    vehicle_type: active.vehicle_type,
    vehicle_model: active.vehicle_model,
    vehicle_plate: active.vehicle_plate,
    vehicle_color: active.vehicle_color,
    vehicles: cleaned,
    active_vehicle_id: active.id,
    updated_at: new Date().toISOString(),
  };
  if (pixKey !== undefined) {
    patch.pix_key = pixKey.trim();
  }

  let { error } = await supabase
    .from('driver_profiles')
    .update(patch)
    .eq('user_id', userId);
  if (error && (error.code === '42703' || error.code === 'PGRST204')) {
    delete patch.vehicles;
    delete patch.active_vehicle_id;
    const retry = await supabase
      .from('driver_profiles')
      .update(patch)
      .eq('user_id', userId);
    error = retry.error;
  }
  if (error) throw new Error(error.message);

  const refreshed = await fetchUserProfileById(userId);
  if (!refreshed) throw new Error('Erro ao atualizar veículo ativo.');
  return refreshed;
}

export async function switchDriverActiveVehicle(
  currentUser: UserProfile,
  vehicleId: string
): Promise<UserProfile> {
  const { vehicles } = getDriverVehiclesList(currentUser);
  const target = vehicles.find((v) => v.id === vehicleId);
  if (!target) throw new Error('Veículo selecionado não encontrado.');
  return saveDriverVehiclesAndSelect(currentUser.id, vehicles, target.id);
}

export async function changeUserPassword(newPassword: string): Promise<void> {
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) throw new Error(translateAuthError(error.message));
}

export async function anonymizeUserAccount(): Promise<void> {
  const { error } = await supabase.rpc('anonymize_own_account');
  if (error) throw new Error(error.message);
  await supabase.auth.signOut();
}

// --- ADMIN OPERATIONS ---

export async function fetchAdminOverview(): Promise<{
  platformConfig: PlatformConfig;
  users: UserProfile[];
  rides: Ride[];
  pricing: PricingSetting[];
  transactions: WalletTransaction[];
  deposits: WalletDeposit[];
  withdrawals: WalletWithdrawal[];
}> {
  const [platformConfig, pricing, profRes, drvRes, rideRes, txRes, depRes, wdRes] =
    await Promise.all([
      fetchPlatformConfig(),
      fetchPricingList(),
      supabase.from('profiles').select('*').order('created_at', { ascending: false }),
      supabase.from('driver_profiles').select('*'),
      supabase.from('rides').select('*').order('created_at', { ascending: false }),
      supabase.from('wallet_transactions').select('*').order('created_at', { ascending: false }),
      supabase.from('wallet_deposits').select('*').order('created_at', { ascending: false }),
      supabase.from('wallet_withdrawals').select('*').order('created_at', { ascending: false }),
    ]);

  const drvMap = new Map<string, Record<string, unknown>>();
  for (const d of drvRes.data || []) {
    drvMap.set(String(d.user_id), d as Record<string, unknown>);
  }

  const users: UserProfile[] = (profRes.data || [])
    .filter((p) => !p.is_anonymized)
    .map((p) => mapDbProfile(p as Record<string, unknown>, drvMap.get(String(p.id))));

  const profilesById = new Map<string, UserProfile>();
  for (const u of users) profilesById.set(u.id, u);

  const rides: Ride[] = (rideRes.data || []).map((r) =>
    mapDbRide(r as Record<string, unknown>, profilesById)
  );

  const transactions: WalletTransaction[] = (txRes.data || []).map((t) => ({
    id: String(t.id),
    user_id: String(t.user_id),
    ride_id: t.ride_id ? String(t.ride_id) : null,
    amount: Number(t.amount),
    type: t.type as WalletTransaction['type'],
    description: String(t.description),
    created_at: String(t.created_at),
  }));

  const deposits: WalletDeposit[] = (depRes.data || []).map((d) => ({
    id: String(d.id),
    user_id: String(d.user_id),
    amount: Number(d.amount),
    status: (d.status as WalletDepositStatus) || 'pending',
    pix_payload: d.pix_payload ? String(d.pix_payload) : null,
    note: d.note ? String(d.note) : null,
    created_at: String(d.created_at),
    reviewed_at: d.reviewed_at ? String(d.reviewed_at) : null,
    user: profilesById.get(String(d.user_id)),
  }));

  const withdrawals: WalletWithdrawal[] = (wdRes.data || []).map((w) => ({
    id: String(w.id),
    user_id: String(w.user_id),
    amount: Number(w.amount),
    pix_key: String(w.pix_key),
    status: (w.status as WalletWithdrawalStatus) || 'pending',
    note: w.note ? String(w.note) : null,
    created_at: String(w.created_at),
    reviewed_at: w.reviewed_at ? String(w.reviewed_at) : null,
    user: profilesById.get(String(w.user_id)),
  }));

  return { platformConfig, users, rides, pricing, transactions, deposits, withdrawals };
}

export async function adminReviewDriver(
  userId: string,
  status: 'active' | 'rejected' | 'suspended',
  rejectionReason?: string
): Promise<void> {
  const { error: profErr } = await supabase
    .from('profiles')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', userId);

  if (profErr) throw new Error(profErr.message);

  await supabase
    .from('driver_profiles')
    .update({
      is_online: status === 'active' ? undefined : false,
      rejection_reason: status === 'active' ? null : rejectionReason || null,
      reviewed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', userId);
}

export async function adminUpdateUserStatus(
  userId: string,
  status: 'active' | 'suspended'
): Promise<void> {
  const { error } = await supabase
    .from('profiles')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', userId);
  if (error) throw new Error(error.message);
}

export async function adminSavePricing(pricingList: PricingSetting[]): Promise<void> {
  for (const p of pricingList) {
    const { error } = await supabase.from('pricing_settings').upsert({
      category: p.category,
      label: p.label,
      description: p.description,
      base_fare: p.base_fare,
      per_km_rate: p.per_km_rate,
      min_fare: p.min_fare,
      active: p.active,
      updated_at: new Date().toISOString(),
    });
    if (error) throw new Error(error.message);
  }
}

export async function adminSavePlatformConfig(config: PlatformConfig): Promise<void> {
  const cleanName = config.site_name.trim() || 'Go Driver Mobilidade';
  const cleanPrimary = config.primary_color || '#2563EB';
  const cleanSecondary = config.secondary_color || '#0F172A';

  try {
    localStorage.setItem(
      PLATFORM_BRAND_CACHE_KEY,
      JSON.stringify({
        site_name: cleanName,
        company_address: config.company_address?.trim() || '',
        platform_pix_qr_url: config.platform_pix_qr_url ?? null,
        support_whatsapp: config.support_whatsapp.trim(),
        commission_percent: Number(config.commission_percent || 0),
        app_logo_url: config.app_logo_url ?? null,
        primary_color: cleanPrimary,
        secondary_color: cleanSecondary,
        vehicle_img_moto: config.vehicle_img_moto ?? null,
        vehicle_img_pop: config.vehicle_img_pop ?? null,
        vehicle_img_delivery_moto: config.vehicle_img_delivery_moto ?? null,
        vehicle_img_delivery_car: config.vehicle_img_delivery_car ?? null,
        sound_offer_url: config.sound_offer_url ?? null,
        sound_delivery_url: config.sound_delivery_url ?? null,
        sound_accepted_url: config.sound_accepted_url ?? null,
        sound_arrived_url: config.sound_arrived_url ?? null,
        sound_completed_url: config.sound_completed_url ?? null,
        sound_chat_url: config.sound_chat_url ?? null,
        sound_cancel_url: config.sound_cancel_url ?? null,
        ota_latest_version: config.ota_latest_version ?? '1.2.2',
        ota_apk_url: config.ota_apk_url ?? null,
        ota_web_url: config.ota_web_url ?? null,
        ota_release_notes: config.ota_release_notes ?? null,
        deposit_window_enabled: config.deposit_window_enabled !== false,
        deposit_start_time: normalizeHHMM(config.deposit_start_time, '07:00'),
        deposit_end_time: normalizeHHMM(config.deposit_end_time, '23:30'),
      })
    );
  } catch {
    // Ignore storage restriction
  }

  // Sync White-Label table configuracoes_app gracefully
  await supabase
    .from('configuracoes_app')
    .upsert({
      id: 1,
      app_name: cleanName,
      logo_url: config.app_logo_url ?? null,
      primary_color: cleanPrimary,
      secondary_color: cleanSecondary,
      updated_at: new Date().toISOString(),
    })
    .then(() => undefined, () => undefined);

  const fullPayload = {
    id: 1,
    platform_pix_key: config.platform_pix_key.trim(),
    platform_pix_receiver: config.platform_pix_receiver.trim(),
    platform_city: config.platform_city.trim(),
    company_address: config.company_address?.trim() || null,
    platform_pix_qr_url: config.platform_pix_qr_url ?? null,
    site_name: cleanName,
    support_whatsapp: config.support_whatsapp.trim(),
    commission_percent: Number(config.commission_percent || 0),
    maintenance_mode: Boolean(config.maintenance_mode),
    app_logo_url: config.app_logo_url ?? null,
    primary_color: cleanPrimary,
    secondary_color: cleanSecondary,
    vehicle_img_moto: config.vehicle_img_moto ?? null,
    vehicle_img_pop: config.vehicle_img_pop ?? null,
    vehicle_img_delivery_moto: config.vehicle_img_delivery_moto ?? null,
    vehicle_img_delivery_car: config.vehicle_img_delivery_car ?? null,
    sound_offer_url: config.sound_offer_url ?? null,
    sound_delivery_url: config.sound_delivery_url ?? null,
    sound_accepted_url: config.sound_accepted_url ?? null,
    sound_arrived_url: config.sound_arrived_url ?? null,
    sound_completed_url: config.sound_completed_url ?? null,
    sound_chat_url: config.sound_chat_url ?? null,
    sound_cancel_url: config.sound_cancel_url ?? null,
    ota_latest_version: config.ota_latest_version?.trim() || '1.2.2',
    ota_apk_url: config.ota_apk_url?.trim() || null,
    ota_web_url: config.ota_web_url?.trim() || null,
    ota_release_notes: config.ota_release_notes?.trim() || null,
    deposit_window_enabled: config.deposit_window_enabled !== false,
    deposit_start_time: normalizeHHMM(config.deposit_start_time, '07:00'),
    deposit_end_time: normalizeHHMM(config.deposit_end_time, '23:30'),
    updated_at: new Date().toISOString(),
  };

  let workingPayload: Record<string, unknown> = { ...fullPayload };
  let { error } = await supabase.from('platform_settings').upsert(workingPayload);
  let pixQrColumnMissing = false;

  // Progressively strip only the exact missing column when schema hasn't run latest delta yet
  for (let attempt = 0; attempt < 10 && error && (error.code === '42703' || error.code === 'PGRST204'); attempt++) {
    const msg = String(error.message || '');
    const match =
      msg.match(/Could not find the '([^']+)' column/i) ||
      msg.match(/column "?([a-zA-Z0-9_]+)"? of relation/i) ||
      msg.match(/column "?([a-zA-Z0-9_]+)"? does not exist/i);
    const missingCol = match?.[1];
    if (missingCol && missingCol in workingPayload) {
      if (missingCol === 'platform_pix_qr_url' && config.platform_pix_qr_url) {
        pixQrColumnMissing = true;
      }
      const nextPayload = { ...workingPayload };
      delete nextPayload[missingCol];
      workingPayload = nextPayload;
      const retryRes = await supabase.from('platform_settings').upsert(workingPayload);
      error = retryRes.error;
    } else {
      break;
    }
  }

  if (error && (error.code === '42703' || error.code === 'PGRST204')) {
    const legacyV15Retry = await supabase.from('platform_settings').upsert({
      id: 1,
      platform_pix_key: config.platform_pix_key.trim(),
      platform_pix_receiver: config.platform_pix_receiver.trim(),
      platform_city: config.platform_city.trim(),
      site_name: cleanName,
      support_whatsapp: config.support_whatsapp.trim(),
      commission_percent: Number(config.commission_percent || 0),
      maintenance_mode: Boolean(config.maintenance_mode),
      app_logo_url: config.app_logo_url ?? null,
      primary_color: cleanPrimary,
      secondary_color: cleanSecondary,
      vehicle_img_moto: config.vehicle_img_moto ?? null,
      vehicle_img_pop: config.vehicle_img_pop ?? null,
      vehicle_img_delivery_moto: config.vehicle_img_delivery_moto ?? null,
      vehicle_img_delivery_car: config.vehicle_img_delivery_car ?? null,
      sound_offer_url: config.sound_offer_url ?? null,
      sound_accepted_url: config.sound_accepted_url ?? null,
      sound_arrived_url: config.sound_arrived_url ?? null,
      updated_at: new Date().toISOString(),
    });
    error = legacyV15Retry.error;
    if (error && (error.code === '42703' || error.code === 'PGRST204')) {
      const retry = await supabase.from('platform_settings').upsert({
        id: 1,
        platform_pix_key: config.platform_pix_key.trim(),
        platform_pix_receiver: config.platform_pix_receiver.trim(),
        platform_city: config.platform_city.trim(),
        updated_at: new Date().toISOString(),
      });
      error = retry.error;
    }
  }
  if (error) throw new Error(error.message);
  if (pixQrColumnMissing) {
    throw new Error(
      'Execute o SQL incremental para criar a coluna platform_pix_qr_url em platform_settings e sincronizar o QR Code para todos os motoristas.'
    );
  }
}

export async function updateUserLanguagePref(userId: string, language: string): Promise<void> {
  const { error } = await supabase
    .from('profiles')
    .update({ preferred_language: language, updated_at: new Date().toISOString() })
    .eq('id', userId);
  if (error && error.code !== '42703') {
    // Non-fatal schema mismatch
  }
}

export async function adminDeleteUserAccount(userId: string): Promise<void> {
  const { error: rpcErr } = await supabase.rpc('admin_delete_user', {
    p_user_id: userId,
  });
  if (rpcErr) {
    // Fallback direct update if RPC isn't created yet
    await supabase
      .from('driver_profiles')
      .update({ is_online: false, updated_at: new Date().toISOString() })
      .eq('user_id', userId);
    const { error } = await supabase
      .from('profiles')
      .update({
        is_anonymized: true,
        status: 'suspended',
        full_name: 'Conta Removida',
        phone: '',
        cpf: '',
        avatar_url: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', userId);
    if (error) throw new Error(error.message);
  }
}

// --- PLATFORM EVENTS (MOTOBOY / DRIVER CAMPAIGNS) ---

export async function fetchPlatformEvents(): Promise<PlatformEvent[]> {
  const { data, error } = await supabase
    .from('platform_events')
    .select('*')
    .order('created_at', { ascending: false });

  if (error || !data) return [];
  return data.map((ev) => ({
    id: String(ev.id),
    title: String(ev.title),
    description: String(ev.description),
    bonus_amount: Number(ev.bonus_amount ?? 0),
    target_role: (ev.target_role as PlatformEvent['target_role']) || 'all',
    active: Boolean(ev.active ?? true),
    created_at: String(ev.created_at),
  }));
}

export async function adminCreatePlatformEvent(input: {
  title: string;
  description: string;
  bonus_amount: number;
  target_role: PlatformEvent['target_role'];
}): Promise<PlatformEvent> {
  const { data, error } = await supabase
    .from('platform_events')
    .insert({
      title: input.title.trim(),
      description: input.description.trim(),
      bonus_amount: Number(input.bonus_amount || 0),
      target_role: input.target_role,
      active: true,
    })
    .select('*')
    .single();
  if (error || !data) throw new Error(error?.message || 'Erro ao criar evento.');
  return {
    id: String(data.id),
    title: String(data.title),
    description: String(data.description),
    bonus_amount: Number(data.bonus_amount ?? 0),
    target_role: (data.target_role as PlatformEvent['target_role']) || 'all',
    active: Boolean(data.active ?? true),
    created_at: String(data.created_at),
  };
}

export async function adminTogglePlatformEvent(eventId: string, active: boolean): Promise<void> {
  const { error } = await supabase
    .from('platform_events')
    .update({ active })
    .eq('id', eventId);
  if (error) throw new Error(error.message);
}

export async function adminDeletePlatformEvent(eventId: string): Promise<void> {
  const { error } = await supabase.from('platform_events').delete().eq('id', eventId);
  if (error) throw new Error(error.message);
}

// --- UNIVERSAL DIRECT CHAT (ADMIN <-> CLIENTE / MOTORISTA / MOTOBOY) ---

export async function fetchDirectMessages(userId: string): Promise<DirectMessage[]> {
  const { data, error } = await supabase
    .from('direct_messages')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: true });

  if (error || !data) return [];
  return data.map((m) => ({
    id: String(m.id),
    user_id: String(m.user_id),
    sender_id: String(m.sender_id),
    sender_name: String(m.sender_name),
    sender_role: (m.sender_role as DirectMessage['sender_role']) || 'passenger',
    content: String(m.content),
    created_at: String(m.created_at),
  }));
}

export async function sendDirectMessage(input: {
  userId: string;
  senderId: string;
  senderName: string;
  senderRole: DirectMessage['sender_role'];
  content: string;
}): Promise<DirectMessage> {
  const { data, error } = await supabase
    .from('direct_messages')
    .insert({
      user_id: input.userId,
      sender_id: input.senderId,
      sender_name: input.senderName,
      sender_role: input.senderRole,
      content: input.content.trim(),
    })
    .select('*')
    .single();
  if (error || !data) {
    throw new Error(error?.message || 'Erro ao enviar mensagem direta.');
  }
  return {
    id: String(data.id),
    user_id: String(data.user_id),
    sender_id: String(data.sender_id),
    sender_name: String(data.sender_name),
    sender_role: (data.sender_role as DirectMessage['sender_role']) || 'passenger',
    content: String(data.content),
    created_at: String(data.created_at),
  };
}

export async function adminConfirmPixRide(ride: Ride): Promise<void> {
  const fare = Number((ride.final_fare ?? ride.estimated_fare).toFixed(2));
  const { error } = await supabase
    .from('rides')
    .update({
      payment_method: 'pix',
      payment_status: 'paid_pix',
      final_fare: fare,
      pix_declared_at: ride.pix_declared_at || new Date().toISOString(),
    })
    .eq('id', ride.id);

  if (error) throw new Error(error.message);

  if (ride.driver_id) {
    const isDelivery = ride.category === 'delivery_moto' || ride.category === 'delivery_car';
    await creditDriverForPixRideIdempotent(
      ride.driver_id,
      ride.id,
      fare,
      `${isDelivery ? 'Entrega Pix confirmada' : 'Corrida Pix confirmada'} #${ride.id.slice(-4)} · ${
        ride.destination_address.split(',')[0]
      }`
    );
  }

  await clearPassengerIncludedDebtIfAny(ride);
}

export async function adminAssignClientDebt(
  clientId: string,
  amount: number,
  note?: string
): Promise<void> {
  const cleanAmount = Number(Math.max(0, amount).toFixed(2));
  const { error } = await supabase
    .from('profiles')
    .update({
      pending_debt_amount: cleanAmount,
      pending_debt_note:
        cleanAmount > 0 ? note?.trim() || 'Corrida não paga' : null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', clientId);

  if (error) {
    if (error.code === '42703') {
      throw new Error(
        'Aplique o SQL incremental na aba "SQL & APK" para habilitar cobrança de corridas não pagas no banco.'
      );
    }
    throw new Error(error.message);
  }
}

export async function adminSettleDispute(
  ride: Ride,
  chargeClientAsUnpaid = false
): Promise<void> {
  const fare = Number((ride.final_fare ?? ride.estimated_fare).toFixed(2));
  const { error } = await supabase
    .from('rides')
    .update({
      payment_status: 'admin_settled',
      status: 'completed',
      final_fare: fare,
      completed_at: ride.completed_at || new Date().toISOString(),
    })
    .eq('id', ride.id);

  if (error) throw new Error(error.message);

  if (ride.driver_id) {
    await creditDriverForPixRideIdempotent(
      ride.driver_id,
      ride.id,
      fare,
      `Disputa assumida pelo Admin · Corrida #${ride.id.slice(-4)}`,
      'dispute_settlement'
    );
  }

  if (chargeClientAsUnpaid && ride.passenger_id) {
    const { data: prof } = await supabase
      .from('profiles')
      .select('pending_debt_amount')
      .eq('id', ride.passenger_id)
      .maybeSingle();
    const existingDebt = Number(prof?.pending_debt_amount ?? 0);
    await adminAssignClientDebt(
      ride.passenger_id,
      Number((existingDebt + fare).toFixed(2)),
      `Corrida não paga #${ride.id.slice(-4)}`
    );
  }
}

export async function adminPayDriverPix(
  driver: UserProfile,
  amount?: number,
  description?: string
): Promise<void> {
  const payAmount = Number(
    Math.min(driver.wallet_balance, amount ?? driver.wallet_balance).toFixed(2)
  );
  if (payAmount <= 0) return;

  const note =
    description?.trim() ||
    `Repasse Pix enviado para ${driver.driver?.pix_key || driver.email}`;

  const { error: rpcErr } = await supabase.rpc('admin_register_payout', {
    p_driver_id: driver.id,
    p_amount: payAmount,
    p_description: note,
  });

  if (rpcErr) {
    // Fallback direct updates
    const nextBal = Number(Math.max(0, driver.wallet_balance - payAmount).toFixed(2));
    const { error: updErr } = await supabase
      .from('profiles')
      .update({ wallet_balance: nextBal, updated_at: new Date().toISOString() })
      .eq('id', driver.id);
    if (updErr) throw new Error(updErr.message);

    await supabase.from('wallet_transactions').insert({
      user_id: driver.id,
      amount: -payAmount,
      type: 'payout',
      description: note,
    });
  }
}

// --- CARTEIRA DO CLIENTE (DEPÓSITOS PIX) & GESTÃO DE SALDOS ADMIN ---

export async function fetchMyWalletDeposits(userId: string): Promise<WalletDeposit[]> {
  const { data, error } = await supabase
    .from('wallet_deposits')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (error || !data) return [];
  return data.map((d) => ({
    id: String(d.id),
    user_id: String(d.user_id),
    amount: Number(d.amount),
    status: (d.status as WalletDepositStatus) || 'pending',
    pix_payload: d.pix_payload ? String(d.pix_payload) : null,
    note: d.note ? String(d.note) : null,
    created_at: String(d.created_at),
    reviewed_at: d.reviewed_at ? String(d.reviewed_at) : null,
  }));
}

export async function createWalletDepositRequest(
  userId: string,
  amount: number,
  pixPayload: string,
  note?: string
): Promise<WalletDeposit> {
  const cfg = await fetchPlatformConfig().catch(() => null);
  const windowStatus = getDepositWindowStatus(cfg);
  if (!windowStatus.isOpen) {
    throw new Error(
      `Horário de depósitos Pix encerrado no momento. Novos depósitos funcionam das ${windowStatus.startTime} às ${windowStatus.endTime}. Quem já tem saldo GoPay continua usando normalmente!`
    );
  }

  const cleanAmount = Number(Math.max(1, amount).toFixed(2));
  const { data, error } = await supabase
    .from('wallet_deposits')
    .insert({
      user_id: userId,
      amount: cleanAmount,
      status: 'pending',
      pix_payload: pixPayload,
      note: note?.trim() || null,
    })
    .select('*')
    .single();

  if (error || !data) {
    throw new Error(
      error?.message ||
        'Erro ao registrar solicitação de depósito. Verifique se a seção 17 do SQL foi aplicada.'
    );
  }

  return {
    id: String(data.id),
    user_id: String(data.user_id),
    amount: Number(data.amount),
    status: (data.status as WalletDepositStatus) || 'pending',
    pix_payload: data.pix_payload ? String(data.pix_payload) : null,
    note: data.note ? String(data.note) : null,
    created_at: String(data.created_at),
    reviewed_at: data.reviewed_at ? String(data.reviewed_at) : null,
  };
}

export async function adminApproveWalletDeposit(
  deposit: WalletDeposit,
  note?: string
): Promise<void> {
  const { error: rpcErr } = await supabase.rpc('admin_approve_wallet_deposit', {
    p_deposit_id: deposit.id,
    p_note: note?.trim() || null,
  });

  if (rpcErr) {
    const { data: depRow } = await supabase
      .from('wallet_deposits')
      .select('status')
      .eq('id', deposit.id)
      .maybeSingle();
    if (depRow?.status === 'approved') return;

    const { error: updDepErr } = await supabase
      .from('wallet_deposits')
      .update({
        status: 'approved',
        note: note?.trim() || deposit.note || null,
        reviewed_at: new Date().toISOString(),
      })
      .eq('id', deposit.id);
    if (updDepErr) throw new Error(updDepErr.message);

    const { data: prof } = await supabase
      .from('profiles')
      .select('wallet_balance')
      .eq('id', deposit.user_id)
      .maybeSingle();
    const nextBal = Number((Number(prof?.wallet_balance ?? 0) + deposit.amount).toFixed(2));
    const { error: profErr } = await supabase
      .from('profiles')
      .update({ wallet_balance: nextBal, updated_at: new Date().toISOString() })
      .eq('id', deposit.user_id);
    if (profErr) throw new Error(profErr.message);

    await supabase.from('wallet_transactions').insert({
      user_id: deposit.user_id,
      amount: deposit.amount,
      type: 'deposit',
      description: note?.trim() || 'Depósito Pix confirmado pelo Administrador',
    });
  }
}

export async function adminRejectWalletDeposit(
  depositId: string,
  reason?: string
): Promise<void> {
  const { error } = await supabase
    .from('wallet_deposits')
    .update({
      status: 'rejected',
      note: reason?.trim() || 'Depósito não localizado no extrato bancário',
      reviewed_at: new Date().toISOString(),
    })
    .eq('id', depositId);
  if (error) throw new Error(error.message);
}

export async function adminUpdateUserWalletBalance(
  user: UserProfile,
  newBalance: number,
  description?: string
): Promise<void> {
  const targetBal = Number(Math.max(0, newBalance).toFixed(2));
  const cleanDesc =
    description?.trim() || 'Ajuste manual de saldo pelo Administrador';

  const { error: rpcErr } = await supabase.rpc('admin_adjust_user_wallet', {
    p_user_id: user.id,
    p_new_balance: targetBal,
    p_description: cleanDesc,
  });

  if (rpcErr) {
    const currentBal = Number(user.wallet_balance || 0);
    const delta = Number((targetBal - currentBal).toFixed(2));
    const { error: updErr } = await supabase
      .from('profiles')
      .update({ wallet_balance: targetBal, updated_at: new Date().toISOString() })
      .eq('id', user.id);
    if (updErr) throw new Error(updErr.message);

    if (delta !== 0) {
      await supabase.from('wallet_transactions').insert({
        user_id: user.id,
        amount: delta,
        type: 'admin_adjustment',
        description: cleanDesc,
      });
    }
  }
}

export async function updateMyPay66Key(userId: string, newKey: string): Promise<UserProfile> {
  const clean = newKey.trim().replace(/\s+/g, '');
  if (clean.length < 4 || clean.length > 64) {
    throw new Error('Informe uma Chave GoPay válida entre 4 e 64 caracteres.');
  }

  const { error: rpcErr } = await supabase.rpc('update_my_pay66_key', {
    p_new_key: clean,
  });

  if (rpcErr) {
    const rpcMsg = String(rpcErr.message || '');
    const missingRpc =
      rpcErr.code === '42883' ||
      rpcErr.code === 'PGRST202' ||
      rpcMsg.toLowerCase().includes('could not find the function');
    if (!missingRpc) {
      throw new Error(rpcMsg);
    }

    const { error: updErr } = await supabase
      .from('profiles')
      .update({ pay66_key: clean, updated_at: new Date().toISOString() })
      .eq('id', userId);
    if (updErr) {
      if (updErr.code === '23505') {
        throw new Error('Esta Chave GoPay já está em uso por outro usuário.');
      }
      throw new Error(updErr.message);
    }
  }

  const refreshed = await fetchUserProfileById(userId);
  if (!refreshed) throw new Error('Erro ao recarregar perfil após salvar Chave GoPay.');
  return refreshed;
}

function extractPay66Token(rawInput: string): string {
  const clean = rawInput.trim();
  const upper = clean.toUpperCase();
  if (
    upper.startsWith('66PAY|') ||
    upper.startsWith('BOREALPAY|') ||
    upper.startsWith('GOPAY|')
  ) {
    const parts = clean.split('|');
    return (parts[1] || parts[2] || clean).trim();
  }
  return clean;
}

export async function lookupWalletRecipient(query: string): Promise<WalletRecipientMatch[]> {
  const clean = query.trim();
  if (clean.length < 3) return [];
  const token = extractPay66Token(clean);
  const upperClean = clean.toUpperCase();
  const rpcQuery =
    upperClean.startsWith('BOREALPAY|') || upperClean.startsWith('GOPAY|') ? token : clean;

  const { data, error } = await supabase.rpc('lookup_wallet_recipient', {
    p_query: rpcQuery,
  });

  if (!error && Array.isArray(data)) {
    return data.map((r) => ({
      id: String(r.id),
      full_name: String(r.full_name || 'Usuário'),
      email: String(r.email || ''),
      phone: String(r.phone || ''),
      role: (r.role as WalletRecipientMatch['role']) || 'passenger',
      avatar_url: r.avatar_url ? String(r.avatar_url) : null,
      pay66_key: r.pay66_key ? String(r.pay66_key) : null,
    }));
  }

  // Fallback direct query on profiles if RPC isn't deployed yet
  const digits = token.replace(/\D/g, '');
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(token);
  let q = supabase
    .from('profiles')
    .select('id,full_name,email,phone,role,avatar_url,pay66_key')
    .neq('role', 'admin')
    .eq('is_anonymized', false)
    .limit(6);

  if (isUuid) {
    q = q.eq('id', token);
  } else if (token.includes('@')) {
    q = q.or(`email.ilike.%${token.toLowerCase()}%,pay66_key.ilike.%${token}%`);
  } else if (digits.length >= 4) {
    q = q.or(`phone.ilike.%${digits}%,cpf.ilike.%${digits}%,pay66_key.ilike.%${token}%`);
  } else {
    q = q.or(`full_name.ilike.%${token}%,pay66_key.ilike.%${token}%`);
  }

  const { data: fallback } = await q;
  return (fallback || []).map((r) => ({
    id: String(r.id),
    full_name: String(r.full_name || 'Usuário'),
    email: String(r.email || ''),
    phone: String(r.phone || ''),
    role: (r.role as WalletRecipientMatch['role']) || 'passenger',
    avatar_url: r.avatar_url ? String(r.avatar_url) : null,
    pay66_key: r.pay66_key ? String(r.pay66_key) : null,
  }));
}

export async function transferirSaldo66(
  destinatario: string,
  valor: number,
  observacao?: string
): Promise<WalletTransaction | null> {
  const cleanTarget = extractPay66Token(destinatario);
  const cleanAmount = Number(Math.max(0, valor).toFixed(2));
  if (!cleanTarget) {
    throw new Error('Informe o destinatário da transferência GoPay.');
  }
  if (cleanAmount < 1) {
    throw new Error('O valor mínimo para transferência GoPay é R$ 1,00.');
  }

  const { data: rpc66Data, error: rpc66Err } = await supabase.rpc('transferir_saldo_66', {
    p_destinatario: cleanTarget,
    p_valor: cleanAmount,
    p_observacao: observacao?.trim() || null,
  });

  if (!rpc66Err) {
    const payload = (rpc66Data || {}) as {
      tx_id?: string;
      recipient_name?: string;
      amount?: number;
      created_at?: string;
      description?: string;
    };
    const { data: sessionData } = await supabase.auth.getSession();
    const uid = sessionData.session?.user?.id || '';
    return {
      id: payload.tx_id ? String(payload.tx_id) : `GO-${Date.now()}`,
      user_id: uid,
      amount: -Number(payload.amount ?? cleanAmount),
      type: 'transfer_out',
      description:
        payload.description ||
        `Enviado para ${payload.recipient_name || cleanTarget}${
          observacao?.trim() ? ` · ${observacao.trim()}` : ''
        }`,
      created_at: payload.created_at || new Date().toISOString(),
    };
  }

  // Fallback to UUID RPC alias if only transfer_wallet_balance is present
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (uuidRegex.test(cleanTarget)) {
    const { error: legacyErr } = await supabase.rpc('transfer_wallet_balance', {
      p_to_user_id: cleanTarget,
      p_amount: cleanAmount,
      p_note: observacao?.trim() || null,
    });
    if (!legacyErr) return null;
    throw new Error(legacyErr.message || rpc66Err.message || 'Erro ao transferir saldo.');
  }

  throw new Error(rpc66Err.message || 'Erro ao transferir saldo na carteira GoPay.');
}

export async function transferWalletBalance(
  toUserId: string,
  amount: number,
  note?: string
): Promise<void> {
  await transferirSaldo66(toUserId, amount, note);
}

export async function fetchMyWalletWithdrawals(userId: string): Promise<WalletWithdrawal[]> {
  const { data, error } = await supabase
    .from('wallet_withdrawals')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (error || !data) return [];
  return data.map((w) => ({
    id: String(w.id),
    user_id: String(w.user_id),
    amount: Number(w.amount),
    pix_key: String(w.pix_key),
    status: (w.status as WalletWithdrawalStatus) || 'pending',
    note: w.note ? String(w.note) : null,
    created_at: String(w.created_at),
    reviewed_at: w.reviewed_at ? String(w.reviewed_at) : null,
  }));
}

export async function requestWalletWithdrawal(amount: number, pixKey: string): Promise<string> {
  const cleanAmount = Number(Math.max(0, amount).toFixed(2));
  const cleanPix = pixKey.trim();
  if (cleanAmount < 5) {
    throw new Error('O valor mínimo para solicitação de saque é R$ 5,00.');
  }
  if (!cleanPix) {
    throw new Error('Informe uma chave Pix válida para receber o saque.');
  }

  const { data, error } = await supabase.rpc('request_wallet_withdrawal', {
    p_amount: cleanAmount,
    p_pix_key: cleanPix,
  });

  if (error) {
    throw new Error(error.message || 'Erro ao solicitar saque. Verifique o SQL incremental.');
  }
  return String(data || '');
}

export async function adminProcessWalletWithdrawal(
  withdrawalId: string,
  action: 'paid' | 'rejected',
  note?: string
): Promise<void> {
  const { error } = await supabase.rpc('admin_process_wallet_withdrawal', {
    p_withdrawal_id: withdrawalId,
    p_action: action,
    p_note: note?.trim() || null,
  });

  if (error) {
    throw new Error(error.message || 'Erro ao processar saque no Supabase.');
  }
}

export async function checkSupabaseHealth(): Promise<{ ok: boolean; detail: string }> {
  try {
    const res = await fetch(`${supabaseUrl}/rest/v1/pricing_settings?select=category&limit=1`, {
      headers: { apikey: supabaseAnonKey },
    });
    return {
      ok: res.ok,
      detail: res.ok ? 'Conectado ao Supabase' : `HTTP ${res.status}`,
    };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : 'Sem conexão' };
  }
}

// --- CENTRAL DE NOTIFICAÇÕES (PASSAGEIRO, MOTORISTA & ADMIN) ---

function mapDbNotification(
  row: Record<string, unknown>,
  readIds?: Set<string>
): AppNotification {
  const id = String(row.id);
  return {
    id,
    title: String(row.title || ''),
    message: String(row.message || ''),
    category: (row.category as NotificationCategory) || 'general',
    target_scope: (row.target_scope as NotificationTargetScope) || 'all',
    target_user_id: row.target_user_id ? String(row.target_user_id) : null,
    action_tab: row.action_tab ? String(row.action_tab) : null,
    metadata:
      row.metadata && typeof row.metadata === 'object'
        ? (row.metadata as Record<string, unknown>)
        : {},
    created_by: row.created_by ? String(row.created_by) : null,
    created_at: String(row.created_at || new Date().toISOString()),
    is_read: readIds ? readIds.has(id) : false,
  };
}

export async function fetchMyNotifications(user: UserProfile): Promise<AppNotification[]> {
  const [{ data: rows, error }, { data: reads }] = await Promise.all([
    supabase
      .from('app_notifications')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(60),
    supabase
      .from('notification_reads')
      .select('notification_id')
      .eq('user_id', user.id),
  ]);

  if (error || !rows) return [];
  const readIds = new Set((reads || []).map((r) => String(r.notification_id)));

  return rows
    .filter((r) => {
      const scope = String(r.target_scope || 'all');
      if (scope === 'all') return true;
      if (scope === 'user') return String(r.target_user_id || '') === user.id;
      if (scope === 'passengers') return user.role === 'passenger';
      if (scope === 'drivers') return user.role === 'driver';
      return false;
    })
    .map((r) => mapDbNotification(r as Record<string, unknown>, readIds));
}

export async function markNotificationRead(
  notificationId: string,
  userId: string
): Promise<void> {
  await supabase
    .from('notification_reads')
    .upsert(
      {
        notification_id: notificationId,
        user_id: userId,
        read_at: new Date().toISOString(),
      },
      { onConflict: 'notification_id,user_id' }
    )
    .then(() => undefined, () => undefined);
}

export async function markAllNotificationsRead(
  notificationIds: string[],
  userId: string
): Promise<void> {
  if (notificationIds.length === 0) return;
  const now = new Date().toISOString();
  await supabase
    .from('notification_reads')
    .upsert(
      notificationIds.map((nid) => ({
        notification_id: nid,
        user_id: userId,
        read_at: now,
      })),
      { onConflict: 'notification_id,user_id' }
    )
    .then(() => undefined, () => undefined);
}

export async function adminFetchSentNotifications(): Promise<AppNotification[]> {
  const { data, error } = await supabase
    .from('app_notifications')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(60);

  if (error || !data) return [];
  return data.map((r) => mapDbNotification(r as Record<string, unknown>));
}

export async function adminSendNotification(input: {
  title: string;
  message: string;
  category: NotificationCategory;
  target_scope: NotificationTargetScope;
  target_user_id?: string | null;
  action_tab?: string | null;
  metadata?: Record<string, unknown>;
  created_by?: string | null;
}): Promise<AppNotification> {
  const { data, error } = await supabase
    .from('app_notifications')
    .insert({
      title: input.title.trim(),
      message: input.message.trim(),
      category: input.category,
      target_scope: input.target_scope,
      target_user_id: input.target_scope === 'user' ? input.target_user_id || null : null,
      action_tab: input.action_tab || null,
      metadata: input.metadata || {},
      created_by: input.created_by || null,
    })
    .select('*')
    .single();

  if (error || !data) {
    throw new Error(
      error?.message || 'Erro ao enviar notificação. Verifique se o SQL incremental foi executado.'
    );
  }
  return mapDbNotification(data as Record<string, unknown>);
}

// --- CUPONS DE DESCONTO ---

function mapDbCoupon(row: Record<string, unknown>): Coupon {
  return {
    id: String(row.id),
    code: String(row.code || '').toUpperCase(),
    title: String(row.title || ''),
    description: String(row.description || ''),
    discount_type: row.discount_type === 'fixed' ? 'fixed' : 'percent',
    discount_value: Number(row.discount_value ?? 0),
    max_discount: row.max_discount !== null && row.max_discount !== undefined ? Number(row.max_discount) : null,
    min_ride_fare: Number(row.min_ride_fare ?? 0),
    active: Boolean(row.active ?? true),
    expires_at: row.expires_at ? String(row.expires_at) : null,
    created_at: String(row.created_at || new Date().toISOString()),
  };
}

export function computeCouponDiscount(coupon: Coupon, baseFare: number): number {
  if (!coupon.active || baseFare <= 0) return 0;
  if (coupon.expires_at && new Date(coupon.expires_at).getTime() < Date.now()) return 0;
  if (baseFare < (coupon.min_ride_fare || 0)) return 0;

  let discount =
    coupon.discount_type === 'percent'
      ? baseFare * (coupon.discount_value / 100)
      : coupon.discount_value;

  if (coupon.max_discount && coupon.max_discount > 0) {
    discount = Math.min(discount, coupon.max_discount);
  }
  // Preserva mínimo operacional simbólico de R$ 1,00 quando corrida for maior
  const maxAllowed = Math.max(0, baseFare - 1);
  return Number(Math.min(maxAllowed, Math.max(0, discount)).toFixed(2));
}

export async function fetchMyAvailableCoupons(userId: string): Promise<UserCoupon[]> {
  const { data: grants, error } = await supabase
    .from('user_coupons')
    .select('*, coupon:coupons(*)')
    .eq('user_id', userId)
    .eq('status', 'available')
    .order('granted_at', { ascending: false });

  if (error || !grants) return [];

  const now = Date.now();
  return grants
    .map((g) => {
      const cRaw = g.coupon as Record<string, unknown> | null;
      const coupon = cRaw ? mapDbCoupon(cRaw) : null;
      return {
        id: String(g.id),
        coupon_id: String(g.coupon_id),
        user_id: String(g.user_id),
        status: (g.status as UserCoupon['status']) || 'available',
        used_ride_id: g.used_ride_id ? String(g.used_ride_id) : null,
        granted_at: String(g.granted_at),
        used_at: g.used_at ? String(g.used_at) : null,
        coupon,
      } satisfies UserCoupon;
    })
    .filter((uc) => {
      if (!uc.coupon || !uc.coupon.active) return false;
      if (uc.coupon.expires_at && new Date(uc.coupon.expires_at).getTime() < now) return false;
      return true;
    });
}

export async function adminFetchCouponsOverview(): Promise<{
  coupons: Coupon[];
  grants: UserCoupon[];
}> {
  const [{ data: couponRows }, { data: grantRows }] = await Promise.all([
    supabase.from('coupons').select('*').order('created_at', { ascending: false }),
    supabase
      .from('user_coupons')
      .select('*')
      .order('granted_at', { ascending: false })
      .limit(200),
  ]);

  const coupons = (couponRows || []).map((c) => mapDbCoupon(c as Record<string, unknown>));
  const couponMap = new Map(coupons.map((c) => [c.id, c]));

  const grants: UserCoupon[] = (grantRows || []).map((g) => ({
    id: String(g.id),
    coupon_id: String(g.coupon_id),
    user_id: String(g.user_id),
    status: (g.status as UserCoupon['status']) || 'available',
    used_ride_id: g.used_ride_id ? String(g.used_ride_id) : null,
    granted_at: String(g.granted_at),
    used_at: g.used_at ? String(g.used_at) : null,
    coupon: couponMap.get(String(g.coupon_id)) || null,
  }));

  return { coupons, grants };
}

export async function adminCreateCoupon(input: {
  code: string;
  title: string;
  description: string;
  discount_type: 'percent' | 'fixed';
  discount_value: number;
  max_discount?: number | null;
  min_ride_fare?: number;
  expires_at?: string | null;
}): Promise<Coupon> {
  const cleanCode = input.code.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '');
  if (!cleanCode || cleanCode.length < 3) {
    throw new Error('Informe um código de cupom com pelo menos 3 caracteres.');
  }

  const { data, error } = await supabase
    .from('coupons')
    .insert({
      code: cleanCode,
      title: input.title.trim(),
      description: input.description.trim(),
      discount_type: input.discount_type,
      discount_value: Number(input.discount_value),
      max_discount:
        input.max_discount && input.max_discount > 0 ? Number(input.max_discount) : null,
      min_ride_fare: Number(input.min_ride_fare || 0),
      active: true,
      expires_at: input.expires_at || null,
    })
    .select('*')
    .single();

  if (error || !data) {
    throw new Error(error?.message || 'Erro ao criar cupom no Supabase.');
  }
  return mapDbCoupon(data as Record<string, unknown>);
}

export async function adminToggleCoupon(couponId: string, active: boolean): Promise<void> {
  const { error } = await supabase.from('coupons').update({ active }).eq('id', couponId);
  if (error) throw new Error(error.message);
}

export async function adminDeleteCoupon(couponId: string): Promise<void> {
  const { error } = await supabase.from('coupons').delete().eq('id', couponId);
  if (error) throw new Error(error.message);
}

export async function adminGrantCouponToUsers(
  couponId: string,
  targetUserId: string | null,
  sendNotification = true
): Promise<number> {
  const { data, error } = await supabase.rpc('admin_grant_coupon', {
    p_coupon_id: couponId,
    p_user_id: targetUserId,
    p_send_notification: sendNotification,
  });

  if (error) {
    throw new Error(
      error.message || 'Erro ao liberar cupom. Verifique se o SQL incremental foi aplicado.'
    );
  }
  return Number(data ?? 0);
}

// --- TRANSFERÊNCIA GOPAY NA CORRIDA (QR CODE / CHAVE GOPAY DO MOTORISTA) ---

export function buildDriver66PayQrPayload(driver: UserProfile): string {
  const key =
    driver.pay66_key ||
    `GO-${driver.id.replace(/-/g, '').slice(0, 8).toUpperCase()}`;
  const cleanName = (driver.full_name || 'Motorista').replace(/\|/g, ' ').trim();
  const cleanEmail = (driver.email || '').replace(/\|/g, '').trim();
  return `GOPAY|${driver.id}|${key}|${cleanEmail}|${cleanName}`;
}

export async function lookup66PayDriver(
  keyOrQr: string
): Promise<import('../types/mobility').Pay66DriverMatch | null> {
  const clean = keyOrQr.trim();
  if (!clean) return null;

  let token = clean;
  const upper = clean.toUpperCase();
  if (
    upper.startsWith('66PAY|') ||
    upper.startsWith('BOREALPAY|') ||
    upper.startsWith('GOPAY|')
  ) {
    const parts = clean.split('|');
    token = (parts[1] || parts[2] || '').trim();
  }

  const rpcKeyArg =
    upper.startsWith('BOREALPAY|') || upper.startsWith('GOPAY|') ? token : clean;
  const { data: rpcData, error: rpcErr } = await supabase.rpc('lookup_66pay_driver', {
    p_key: rpcKeyArg,
  });

  if (!rpcErr && Array.isArray(rpcData) && rpcData.length > 0) {
    const row = rpcData[0] as Record<string, unknown>;
    return {
      id: String(row.id),
      full_name: String(row.full_name || 'Motorista'),
      pay66_key: String(
        row.pay66_key || `GO-${String(row.id).replace(/-/g, '').slice(0, 8).toUpperCase()}`
      ),
      avatar_url: row.avatar_url ? String(row.avatar_url) : null,
      phone: row.phone ? String(row.phone) : '',
      vehicle_model: row.vehicle_model ? String(row.vehicle_model) : null,
      vehicle_plate: row.vehicle_plate ? String(row.vehicle_plate) : null,
    };
  }

  // Fallback query on profiles if RPC isn't applied yet
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(token);
  if (isUuid) {
    const { data: prof } = await supabase
      .from('profiles')
      .select('id, full_name, avatar_url, phone')
      .eq('id', token)
      .maybeSingle();
    if (prof) {
      const { data: drv } = await supabase
        .from('driver_profiles')
        .select('vehicle_model, vehicle_plate')
        .eq('user_id', prof.id)
        .maybeSingle();
      return {
        id: String(prof.id),
        full_name: String(prof.full_name || 'Motorista'),
        pay66_key: `GO-${String(prof.id).replace(/-/g, '').slice(0, 8).toUpperCase()}`,
        avatar_url: prof.avatar_url ? String(prof.avatar_url) : null,
        phone: prof.phone ? String(prof.phone) : '',
        vehicle_model: drv?.vehicle_model ? String(drv.vehicle_model) : null,
        vehicle_plate: drv?.vehicle_plate ? String(drv.vehicle_plate) : null,
      };
    }
  }

  return null;
}

export async function process66PayRideTransfer(
  rideId: string,
  driverKey?: string
): Promise<import('../types/mobility').Pay66ReceiptResult> {
  const { data, error } = await supabase.rpc('process_66pay_ride_transfer', {
    p_ride_id: rideId,
    p_driver_key: driverKey?.trim() || null,
  });

  if (!error && data) {
    const res = data as Record<string, unknown>;
    return {
      ok: Boolean(res.ok ?? true),
      already_paid: Boolean(res.already_paid ?? false),
      ride_id: String(res.ride_id || rideId),
      amount: Number(res.amount ?? 0),
      auth_code: String(res.auth_code || `GPAY-${rideId.slice(0, 8).toUpperCase()}`),
      tx_id: String(res.tx_id || rideId),
      created_at: String(res.created_at || new Date().toISOString()),
      sender_name: String(res.sender_name || 'Cliente'),
      sender_key: String(res.sender_key || ''),
      recipient_name: String(res.recipient_name || 'Motorista'),
      recipient_key: String(res.recipient_key || ''),
      new_passenger_balance:
        res.new_passenger_balance !== undefined ? Number(res.new_passenger_balance) : undefined,
    };
  }

  // Fallback via pay_completed_ride_with_wallet if Section 8 RPC isn't yet deployed
  const { error: legacyErr } = await supabase.rpc('pay_completed_ride_with_wallet', {
    p_ride_id: rideId,
  });
  if (legacyErr) {
    throw new Error(error?.message || legacyErr.message || 'Falha ao processar pagamento GoPay.');
  }

  const ride = await fetchRideByIdEnriched(rideId);
  const driverId = ride?.driver_id || '';
  return {
    ok: true,
    ride_id: rideId,
    amount: Number((ride?.final_fare ?? ride?.estimated_fare ?? 0).toFixed(2)),
    auth_code: `GPAY-${rideId.replace(/-/g, '').slice(0, 12).toUpperCase()}`,
    tx_id: rideId,
    created_at: new Date().toISOString(),
    sender_name: ride?.passenger?.full_name || 'Cliente',
    sender_key:
      ride?.passenger?.pay66_key ||
      `GO-${(ride?.passenger_id || '').replace(/-/g, '').slice(0, 8).toUpperCase()}`,
    recipient_name: ride?.driver?.full_name || 'Motorista',
    recipient_key:
      ride?.driver?.pay66_key ||
      `GO-${driverId.replace(/-/g, '').slice(0, 8).toUpperCase()}`,
  };
}

