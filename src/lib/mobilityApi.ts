import { supabase, supabaseAnonKey, supabaseUrl } from './supabase';
import type {
  DirectMessage,
  DriverDetails,
  GeoPoint,
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
  UserProfile,
  WalletTransaction,
} from '../types/mobility';

export const ADMIN_EMAIL = 'driver@admin.com';

export const DEFAULT_PLATFORM_CONFIG: PlatformConfig = {
  platform_pix_key: 'pix@velo99.app',
  platform_pix_receiver: 'Velo99 Mobilidade Ltda',
  platform_city: 'São Paulo, SP',
  site_name: 'Velo99',
  support_whatsapp: '',
  commission_percent: 0,
  maintenance_mode: false,
};

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

function mapDbDriver(row: Record<string, unknown> | null | undefined): DriverDetails | null {
  if (!row) return null;
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
  };
}

export function mapDbProfile(
  row: Record<string, unknown>,
  driverRow?: Record<string, unknown> | null
): UserProfile {
  const email = String(row.email || '').toLowerCase();
  const rawRole = String(row.role || 'passenger');
  const role = email === ADMIN_EMAIL ? 'admin' : (rawRole as UserProfile['role']);
  const status = email === ADMIN_EMAIL ? 'active' : (String(row.status || 'active') as UserProfile['status']);

  return {
    id: String(row.id),
    role,
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
    preferred_payment: row.preferred_payment === 'cash' ? 'cash' : 'pix',
    rating_avg: Number(row.rating_avg ?? 5),
    rating_count: Number(row.rating_count ?? 0),
    wallet_balance: Number(row.wallet_balance ?? 0),
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
  const paymentMethod: PaymentMethod = row.payment_method === 'cash' ? 'cash' : 'pix';
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
    delivery_notes: row.delivery_notes ? String(row.delivery_notes) : null,
    dispute_reason: row.dispute_reason ? String(row.dispute_reason) : null,
    pix_declared_at: row.pix_declared_at ? String(row.pix_declared_at) : null,
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

export async function compressImageFileToDataUrl(file: File, maxDim = 900): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Falha ao ler imagem'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => resolve(String(reader.result));
      img.onload = () => {
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
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
        resolve(canvas.toDataURL('image/jpeg', 0.72));
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const res = await fetch(dataUrl);
  return res.blob();
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
    const filePath = `${userId}/avatar_${Date.now()}.jpg`;
    const { error } = await supabase.storage
      .from('driver-documents')
      .upload(filePath, blob, { contentType: 'image/jpeg', upsert: true });
    if (!error) {
      const { data: pub } = supabase.storage.from('driver-documents').getPublicUrl(filePath);
      if (pub?.publicUrl) return pub.publicUrl;
    }
  } catch {
    // Fallback to inline compressed JPEG dataUrl
  }
  return dataUrl;
}

export async function resolveDocumentDisplayUrl(rawUrl?: string | null): Promise<string> {
  if (!rawUrl) return '';
  if (rawUrl.startsWith('storage:driver-documents/')) {
    const path = rawUrl.replace('storage:driver-documents/', '');
    const { data } = await supabase.storage
      .from('driver-documents')
      .createSignedUrl(path, 3600);
    if (data?.signedUrl) return data.signedUrl;
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
    const inferredRole =
      cleanEmail === ADMIN_EMAIL
        ? 'admin'
        : meta.role === 'driver'
        ? 'driver'
        : 'passenger';
    const inferredStatus =
      cleanEmail === ADMIN_EMAIL
        ? 'active'
        : inferredRole === 'driver'
        ? 'pending'
        : 'active';

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
  const isAdminEmail = cleanEmail === ADMIN_EMAIL;
  const effectiveRole: UserProfile['role'] = isAdminEmail ? 'admin' : payload.role;
  const effectiveStatus: UserProfile['status'] =
    isAdminEmail || effectiveRole === 'passenger' ? 'active' : 'pending';

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

    const { error: drvErr } = await supabase.from('driver_profiles').upsert({
      user_id: userId,
      cnh_url: cnhStored,
      crlv_url: crlvStored,
      vehicle_type: payload.vehicle_type || 'car',
      vehicle_model: (payload.vehicle_model || '').trim(),
      vehicle_plate: (payload.vehicle_plate || '').trim().toUpperCase(),
      vehicle_color: (payload.vehicle_color || '').trim(),
      pix_key: (payload.pix_key || '').trim(),
      is_online: false,
      current_lat: -23.55052,
      current_lng: -46.633308,
      heading: 0,
    });

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

export async function fetchPlatformConfig(): Promise<PlatformConfig> {
  const { data, error } = await supabase
    .from('platform_settings')
    .select('*')
    .eq('id', 1)
    .maybeSingle();

  if (error || !data) return DEFAULT_PLATFORM_CONFIG;
  return {
    platform_pix_key: String(data.platform_pix_key || DEFAULT_PLATFORM_CONFIG.platform_pix_key),
    platform_pix_receiver: String(
      data.platform_pix_receiver || DEFAULT_PLATFORM_CONFIG.platform_pix_receiver
    ),
    platform_city: String(data.platform_city || DEFAULT_PLATFORM_CONFIG.platform_city),
    site_name: String(data.site_name || DEFAULT_PLATFORM_CONFIG.site_name),
    support_whatsapp: String(data.support_whatsapp || ''),
    commission_percent: Number(data.commission_percent ?? 0),
    maintenance_mode: Boolean(data.maintenance_mode ?? false),
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
      avatar_url: null,
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
}): Promise<Ride> {
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
    estimated_fare: input.estimated_fare,
    negotiated_fare: input.negotiated_fare ?? null,
    pin_code: pin,
    delivery_notes: input.delivery_notes || null,
  };

  let { data, error } = await supabase
    .from('rides')
    .insert(payload)
    .select('*')
    .single();

  if (error && (error.code === '42703' || error.message.includes('category'))) {
    // Fallback if incremental migration hasn't been executed yet on Supabase
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
        category: legacyCategory,
        payment_method: input.payment_method,
        status: 'searching',
        origin_address: input.origin.address,
        origin_lat: input.origin.lat,
        origin_lng: input.origin.lng,
        destination_address: input.destination.address,
        destination_lat: input.destination.lat,
        destination_lng: input.destination.lng,
        distance_km: input.distance_km,
        estimated_fare: input.estimated_fare,
        pin_code: pin,
      })
      .select('*')
      .single();
    data = legacyRes.data;
    error = legacyRes.error;
  }

  if (error || !data) {
    throw new Error(error?.message || 'Erro ao registrar corrida no Supabase.');
  }

  return (await fetchRideByIdEnriched(String(data.id))) || mapDbRide(data as Record<string, unknown>);
}

export async function cancelRide(rideId: string): Promise<Ride | null> {
  const { error } = await supabase
    .from('rides')
    .update({ status: 'cancelled' })
    .eq('id', rideId);

  if (error) throw new Error(error.message);
  return fetchRideByIdEnriched(rideId);
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
  pinInput: string
): Promise<Ride> {
  if (pinInput.trim() !== ride.pin_code) {
    const isDelivery = ride.category === 'delivery_moto' || ride.category === 'delivery_car';
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

async function creditDriverForPixRideIdempotent(
  driverId: string,
  rideId: string,
  amount: number,
  description: string,
  type: 'ride_earning' | 'dispute_settlement' = 'ride_earning'
) {
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
  pinInput?: string
): Promise<Ride> {
  const isDelivery = ride.category === 'delivery_moto' || ride.category === 'delivery_car';
  if (isDelivery && String(pinInput || '').trim() !== ride.pin_code) {
    throw new Error('PIN de entrega incorreto. Peça os 4 dígitos no destino.');
  }

  const finalFare = Number((ride.final_fare ?? ride.estimated_fare).toFixed(2));
  const nextPaymentStatus: PaymentStatus =
    ride.payment_method === 'cash'
      ? 'paid_cash'
      : ride.payment_status === 'paid_pix'
      ? 'paid_pix'
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

  // If paid via centralized Platform Pix, credit the driver's receivable wallet balance
  if (ride.payment_method === 'pix' && nextPaymentStatus === 'paid_pix') {
    await creditDriverForPixRideIdempotent(
      driverId,
      ride.id,
      finalFare,
      `${isDelivery ? 'Entrega Pix' : 'Corrida Pix'} #${ride.id.slice(-4)} · ${
        ride.destination_address.split(',')[0]
      }`
    );
  }

  const enriched = await fetchRideByIdEnriched(ride.id);
  if (!enriched) throw new Error('Corrida não encontrada.');
  return enriched;
}

export async function declarePixPaid(ride: Ride): Promise<Ride> {
  const amount = Number((ride.final_fare ?? ride.estimated_fare).toFixed(2));
  const { error } = await supabase
    .from('rides')
    .update({
      payment_method: 'pix',
      payment_status: 'paid_pix',
      pix_declared_at: new Date().toISOString(),
    })
    .eq('id', ride.id);

  if (error) throw new Error(error.message);

  if (ride.status === 'completed' && ride.driver_id) {
    const isDelivery = ride.category === 'delivery_moto' || ride.category === 'delivery_car';
    await creditDriverForPixRideIdempotent(
      ride.driver_id,
      ride.id,
      amount,
      `${isDelivery ? 'Entrega Pix' : 'Corrida Pix'} #${ride.id.slice(-4)} · ${
        ride.destination_address.split(',')[0]
      }`
    );
  }

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
  const enriched = await fetchRideByIdEnriched(ride.id);
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
    const { error: drvErr } = await supabase
      .from('driver_profiles')
      .update({
        vehicle_type: patch.vehicle_type || currentUser.driver.vehicle_type,
        vehicle_model: (patch.vehicle_model ?? currentUser.driver.vehicle_model).trim(),
        vehicle_plate: (patch.vehicle_plate ?? currentUser.driver.vehicle_plate)
          .trim()
          .toUpperCase(),
        vehicle_color: (patch.vehicle_color ?? currentUser.driver.vehicle_color).trim(),
        pix_key: (patch.pix_key ?? currentUser.driver.pix_key).trim(),
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', currentUser.id);
    if (drvErr) throw new Error(drvErr.message);
  }

  const updated = await fetchUserProfileById(currentUser.id);
  if (!updated) throw new Error('Erro ao recarregar perfil.');
  return updated;
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
}> {
  const [platformConfig, pricing, profRes, drvRes, rideRes, txRes] = await Promise.all([
    fetchPlatformConfig(),
    fetchPricingList(),
    supabase.from('profiles').select('*').order('created_at', { ascending: false }),
    supabase.from('driver_profiles').select('*'),
    supabase.from('rides').select('*').order('created_at', { ascending: false }),
    supabase.from('wallet_transactions').select('*').order('created_at', { ascending: false }),
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

  return { platformConfig, users, rides, pricing, transactions };
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
  const fullPayload = {
    id: 1,
    platform_pix_key: config.platform_pix_key.trim(),
    platform_pix_receiver: config.platform_pix_receiver.trim(),
    platform_city: config.platform_city.trim(),
    site_name: config.site_name.trim() || 'Velo99',
    support_whatsapp: config.support_whatsapp.trim(),
    commission_percent: Number(config.commission_percent || 0),
    maintenance_mode: Boolean(config.maintenance_mode),
    updated_at: new Date().toISOString(),
  };

  let { error } = await supabase.from('platform_settings').upsert(fullPayload);
  if (error && error.code === '42703') {
    const retry = await supabase.from('platform_settings').upsert({
      id: 1,
      platform_pix_key: config.platform_pix_key.trim(),
      platform_pix_receiver: config.platform_pix_receiver.trim(),
      platform_city: config.platform_city.trim(),
      updated_at: new Date().toISOString(),
    });
    error = retry.error;
  }
  if (error) throw new Error(error.message);
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

export async function adminSettleDispute(ride: Ride): Promise<void> {
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
