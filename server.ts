import 'dotenv/config';
import express from 'express';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer as createViteServer } from 'vite';
import type {
  PricingSetting,
  Ride,
  RideCategory,
  RideMessage,
  UserProfile,
  WalletTransaction,
} from './src/types/mobility.ts';

const PORT = 3000;
const DATA_DIR = path.resolve(process.cwd(), '.data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

interface StoredUser extends UserProfile {
  password_hash: string;
  offers_seen?: number;
  offers_accepted?: number;
  rides_started?: number;
  rides_completed?: number;
}

interface DatabaseSchema {
  users: StoredUser[];
  pricing: PricingSetting[];
  rides: Ride[];
  messages: RideMessage[];
  transactions: WalletTransaction[];
}

function hashPassword(pw: string): string {
  return crypto.createHash('sha256').update(pw).digest('hex');
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return Number((R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))).toFixed(2));
}

function createSeedDatabase(): DatabaseSchema {
  const now = new Date().toISOString();
  const sampleCnh = '/assets/images/cnh_doc_sample_1794712286034.jpg';
  const sampleAvatar = '/assets/images/driver_avatar_sample_1794712284790.jpg';
  const sampleCrlv =
    'data:image/svg+xml;utf8,' +
    encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="440" viewBox="0 0 640 440">
        <rect width="640" height="440" rx="20" fill="#eef6ee"/>
        <rect x="24" y="24" width="592" height="68" rx="10" fill="#1b6b3a"/>
        <text x="48" y="66" font-family="sans-serif" font-size="22" font-weight="700" fill="#ffffff">CRLV-e · DOCUMENTO DO VEÍCULO</text>
        <rect x="24" y="112" width="592" height="296" rx="12" fill="#ffffff" stroke="#b7d7c2" stroke-width="2"/>
        <text x="48" y="156" font-family="sans-serif" font-size="14" fill="#4b5563">MODELO / MARCA</text>
        <text x="48" y="182" font-family="monospace" font-size="20" font-weight="700" fill="#111827">HYUNDAI HB20 1.0 VISION</text>
        <text x="48" y="232" font-family="sans-serif" font-size="14" fill="#4b5563">PLACA</text>
        <text x="48" y="258" font-family="monospace" font-size="22" font-weight="700" fill="#111827">XYZ-9K88</text>
        <text x="260" y="232" font-family="sans-serif" font-size="14" fill="#4b5563">COR PREDOMINANTE</text>
        <text x="260" y="258" font-family="monospace" font-size="20" font-weight="700" fill="#111827">PRATA</text>
        <text x="48" y="316" font-family="sans-serif" font-size="14" fill="#4b5563">EXERCÍCIO LICENCIAMENTO</text>
        <text x="48" y="344" font-family="monospace" font-size="20" font-weight="700" fill="#16a34a">2026 · REGULAR</text>
      </svg>`
    );

  return {
    users: [
      {
        id: 'usr-passenger-1',
        role: 'passenger',
        status: 'active',
        full_name: 'Gabriel Oliveira',
        phone: '(11) 97482-4106',
        email: 'gabriel@velo99.app',
        cpf: '384.291.028-11',
        avatar_url: null,
        home_address: {
          label: 'Casa',
          address: 'Rua Augusta, 1420 · Consolação, São Paulo',
          lat: -23.5567,
          lng: -46.6587,
        },
        work_address: {
          label: 'Trabalho',
          address: 'Av. Paulista, 1578 · Bela Vista, São Paulo',
          lat: -23.561414,
          lng: -46.655881,
        },
        preferred_payment: 'pix',
        rating_avg: 4.93,
        rating_count: 42,
        wallet_balance: 0,
        is_anonymized: false,
        created_at: now,
        password_hash: hashPassword('123456'),
      },
      {
        id: 'usr-driver-1',
        role: 'driver',
        status: 'active',
        full_name: 'Rikelmy Santos',
        phone: '(11) 98821-3304',
        email: 'rikelmy@velo99.app',
        cpf: '412.883.190-45',
        avatar_url: sampleAvatar,
        preferred_payment: 'pix',
        rating_avg: 4.98,
        rating_count: 184,
        wallet_balance: 148.5,
        is_anonymized: false,
        created_at: now,
        password_hash: hashPassword('123456'),
        offers_seen: 25,
        offers_accepted: 24,
        rides_started: 24,
        rides_completed: 24,
        driver: {
          user_id: 'usr-driver-1',
          cnh_url: sampleCnh,
          crlv_url: sampleCrlv,
          vehicle_type: 'car',
          vehicle_model: 'Fiat Argo Drive 1.0',
          vehicle_plate: 'ABC-1D23',
          vehicle_color: 'Branco',
          pix_key: 'rikelmy@velo99.app',
          is_online: false,
          current_lat: -23.55052,
          current_lng: -46.633308,
          heading: 45,
          acceptance_rate: 96,
          completion_rate: 100,
          updated_at: now,
        },
      },
      {
        id: 'usr-driver-pending-1',
        role: 'driver',
        status: 'pending',
        full_name: 'Mariana Silva Pereira',
        phone: '(11) 99104-7722',
        email: 'mariana.driver@velo99.app',
        cpf: '987.654.321-00',
        avatar_url: null,
        preferred_payment: 'pix',
        rating_avg: 5.0,
        rating_count: 0,
        wallet_balance: 0,
        is_anonymized: false,
        created_at: now,
        password_hash: hashPassword('123456'),
        offers_seen: 0,
        offers_accepted: 0,
        rides_started: 0,
        rides_completed: 0,
        driver: {
          user_id: 'usr-driver-pending-1',
          cnh_url: sampleCnh,
          crlv_url: sampleCrlv,
          vehicle_type: 'car',
          vehicle_model: 'Hyundai HB20 Vision',
          vehicle_plate: 'XYZ-9K88',
          vehicle_color: 'Prata',
          pix_key: '98765432100',
          is_online: false,
          current_lat: -23.558,
          current_lng: -46.639,
          heading: 0,
          acceptance_rate: 100,
          completion_rate: 100,
          updated_at: now,
        },
      },
      {
        id: 'usr-admin-1',
        role: 'admin',
        status: 'active',
        full_name: 'Super Admin Velo99',
        phone: '(11) 90000-0001',
        email: 'admin@velo99.app',
        cpf: '000.000.000-01',
        avatar_url: null,
        rating_avg: 5.0,
        rating_count: 1,
        wallet_balance: 0,
        is_anonymized: false,
        created_at: now,
        password_hash: hashPassword('admin123'),
      },
    ],
    pricing: [
      {
        category: 'pop',
        label: 'Viagem Carro',
        description: 'Carros econômicos com ar-condicionado',
        base_fare: 4.5,
        per_km_rate: 2.2,
        min_fare: 8.5,
        active: true,
      },
      {
        category: 'moto',
        label: 'Viagem Moto',
        description: 'Viagens rápidas no trânsito urbano',
        base_fare: 3.0,
        per_km_rate: 1.45,
        min_fare: 6.0,
        active: true,
      },
      {
        category: 'delivery',
        label: 'Entrega / Coleta',
        description: 'Envio expresso de pacotes com código PIN',
        base_fare: 3.5,
        per_km_rate: 1.65,
        min_fare: 7.0,
        active: true,
      },
    ],
    rides: [],
    messages: [],
    transactions: [
      {
        id: 'tx-seed-1',
        user_id: 'usr-driver-1',
        amount: 84.0,
        type: 'ride_earning',
        description: 'Corridas concluídas (turno manhã)',
        created_at: now,
      },
      {
        id: 'tx-seed-2',
        user_id: 'usr-driver-1',
        amount: 64.5,
        type: 'ride_earning',
        description: 'Corridas concluídas (turno tarde)',
        created_at: now,
      },
    ],
  };
}

function loadDatabase(): DatabaseSchema {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(DB_FILE)) {
    const seed = createSeedDatabase();
    fs.writeFileSync(DB_FILE, JSON.stringify(seed, null, 2));
    return seed;
  }
  try {
    const raw = fs.readFileSync(DB_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as DatabaseSchema;
    // Backwards-compatible field hydration
    parsed.users = parsed.users.map((u) => ({
      ...u,
      is_anonymized: u.is_anonymized ?? false,
      preferred_payment: u.preferred_payment ?? 'pix',
      driver: u.driver
        ? {
            ...u.driver,
            acceptance_rate: u.driver.acceptance_rate ?? 100,
            completion_rate: u.driver.completion_rate ?? 100,
          }
        : u.driver,
    }));
    return parsed;
  } catch {
    const seed = createSeedDatabase();
    fs.writeFileSync(DB_FILE, JSON.stringify(seed, null, 2));
    return seed;
  }
}

const db: DatabaseSchema = loadDatabase();

function saveDatabase() {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

function sanitizeUser(u: StoredUser): UserProfile {
  const {
    password_hash: _pw,
    offers_seen: _os,
    offers_accepted: _oa,
    rides_started: _rs,
    rides_completed: _rc,
    ...safe
  } = u;
  return safe;
}

// Strict privacy sanitization when embedding driver inside a Ride object
function sanitizeDriverForRide(driver: StoredUser, rideStatus: Ride['status']): UserProfile {
  const isActive = ['accepted', 'arrived', 'in_progress'].includes(rideStatus);
  return {
    id: driver.id,
    role: driver.role,
    status: driver.status,
    full_name: driver.full_name,
    phone: isActive ? driver.phone : '',
    email: '',
    cpf: '',
    avatar_url: driver.avatar_url,
    rating_avg: driver.rating_avg,
    rating_count: driver.rating_count,
    wallet_balance: 0,
    created_at: driver.created_at,
    driver: driver.driver
      ? {
          user_id: driver.driver.user_id,
          cnh_url: '',
          crlv_url: '',
          vehicle_type: driver.driver.vehicle_type,
          vehicle_model: driver.driver.vehicle_model,
          // Plate and live GPS strictly visible ONLY during active rides
          vehicle_plate: isActive ? driver.driver.vehicle_plate : '***-****',
          vehicle_color: driver.driver.vehicle_color,
          pix_key: '',
          is_online: driver.driver.is_online,
          current_lat: isActive ? driver.driver.current_lat : null,
          current_lng: isActive ? driver.driver.current_lng : null,
          heading: isActive ? driver.driver.heading : 0,
          acceptance_rate: driver.driver.acceptance_rate,
          completion_rate: driver.driver.completion_rate,
          updated_at: driver.driver.updated_at,
        }
      : null,
  };
}

function sanitizePassengerForRide(passenger: StoredUser, rideStatus: Ride['status']): UserProfile {
  const isActive = ['accepted', 'arrived', 'in_progress'].includes(rideStatus);
  return {
    id: passenger.id,
    role: passenger.role,
    status: passenger.status,
    full_name: passenger.full_name,
    phone: isActive ? passenger.phone : '',
    email: '',
    cpf: '',
    avatar_url: passenger.avatar_url,
    rating_avg: passenger.rating_avg,
    rating_count: passenger.rating_count,
    wallet_balance: 0,
    created_at: passenger.created_at,
    driver: null,
  };
}

function sanitizeOnlineDriverPublic(driver: StoredUser): UserProfile {
  return {
    id: driver.id,
    role: driver.role,
    status: driver.status,
    full_name: driver.full_name,
    phone: '',
    email: '',
    cpf: '',
    avatar_url: driver.avatar_url,
    rating_avg: driver.rating_avg,
    rating_count: driver.rating_count,
    wallet_balance: 0,
    created_at: driver.created_at,
    driver: driver.driver
      ? {
          user_id: driver.driver.user_id,
          cnh_url: '',
          crlv_url: '',
          vehicle_type: driver.driver.vehicle_type,
          vehicle_model: driver.driver.vehicle_model,
          vehicle_plate: '***-****',
          vehicle_color: driver.driver.vehicle_color,
          pix_key: '',
          is_online: driver.driver.is_online,
          current_lat: driver.driver.current_lat,
          current_lng: driver.driver.current_lng,
          heading: driver.driver.heading,
          acceptance_rate: driver.driver.acceptance_rate,
          completion_rate: driver.driver.completion_rate,
          updated_at: driver.driver.updated_at,
        }
      : null,
  };
}

function enrichRide(ride: Ride): Ride {
  const passenger = db.users.find((u) => u.id === ride.passenger_id);
  const driver = ride.driver_id ? db.users.find((u) => u.id === ride.driver_id) : undefined;
  return {
    ...ride,
    passenger: passenger ? sanitizePassengerForRide(passenger, ride.status) : undefined,
    driver: driver ? sanitizeDriverForRide(driver, ride.status) : undefined,
  };
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '15mb' }));

  const server = http.createServer(app);
  const wss = new WebSocketServer({ noServer: true });
  const clients = new Set<WebSocket>();

  server.on('upgrade', (request, socket, head) => {
    const reqUrl = request.url || '';
    if (reqUrl.startsWith('/ws')) {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    }
  });

  function broadcast(event: string, payload: unknown) {
    const msg = JSON.stringify({ event, payload, timestamp: Date.now() });
    for (const client of clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(msg);
      }
    }
  }

  wss.on('connection', (ws) => {
    clients.add(ws);
    ws.send(
      JSON.stringify({
        event: 'sync:init',
        payload: {
          pricing: db.pricing,
          rides: db.rides.map(enrichRide),
          onlineDrivers: db.users
            .filter(
              (u) =>
                u.role === 'driver' &&
                u.status === 'active' &&
                !u.is_anonymized &&
                u.driver?.is_online
            )
            .map(sanitizeOnlineDriverPublic),
        },
      })
    );

    ws.on('message', (raw) => {
      try {
        const parsed = JSON.parse(raw.toString()) as {
          event?: string;
          payload?: Record<string, unknown>;
        };
        if (parsed.event === 'driver:location' && parsed.payload) {
          const userId = String(parsed.payload.userId || '');
          const lat = Number(parsed.payload.lat);
          const lng = Number(parsed.payload.lng);
          const heading = Number(parsed.payload.heading || 0);
          const driver = db.users.find(
            (u) => u.id === userId && u.driver && u.status === 'active' && u.driver.is_online
          );
          if (driver && driver.driver && Number.isFinite(lat) && Number.isFinite(lng)) {
            driver.driver.current_lat = lat;
            driver.driver.current_lng = lng;
            driver.driver.heading = heading;
            driver.driver.updated_at = new Date().toISOString();
            saveDatabase();
            broadcast('driver:location', { userId, lat, lng, heading });
          }
        }
      } catch {
        // Ignore malformed frames
      }
    });

    ws.on('close', () => {
      clients.delete(ws);
    });
  });

  app.use('/assets/images', express.static(path.resolve(process.cwd(), 'src/assets/images')));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, time: new Date().toISOString() });
  });

  app.get('/api/bootstrap', (_req, res) => {
    const onlineDrivers = db.users
      .filter(
        (u) =>
          u.role === 'driver' &&
          u.status === 'active' &&
          !u.is_anonymized &&
          u.driver?.is_online
      )
      .map(sanitizeOnlineDriverPublic);
    res.json({
      pricing: db.pricing,
      rides: db.rides.map(enrichRide),
      onlineDrivers,
    });
  });

  app.get('/api/schema-sql', (_req, res) => {
    const sqlPath = path.resolve(process.cwd(), 'supabase/schema.sql');
    if (fs.existsSync(sqlPath)) {
      res.type('text/plain').send(fs.readFileSync(sqlPath, 'utf-8'));
    } else {
      res.status(404).send('-- schema.sql não encontrado');
    }
  });

  app.post('/api/auth/register', (req, res) => {
    const {
      role,
      full_name,
      phone,
      email,
      cpf,
      password,
      cnh_url,
      crlv_url,
      vehicle_type,
      vehicle_model,
      vehicle_plate,
      vehicle_color,
      pix_key,
    } = req.body;

    if (!full_name || !phone || !email || !cpf || !password) {
      return res.status(400).json({ error: 'Preencha todos os campos obrigatórios.' });
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    if (db.users.some((u) => u.email.toLowerCase() === normalizedEmail)) {
      return res.status(409).json({ error: 'Este e-mail já está cadastrado.' });
    }

    if (role === 'driver') {
      if (!cnh_url || !crlv_url || !vehicle_model || !vehicle_plate || !vehicle_color || !pix_key) {
        return res.status(400).json({
          error: 'Motoristas/Entregadores precisam enviar CNH, CRLV, dados do veículo e chave Pix.',
        });
      }
    }

    const now = new Date().toISOString();
    const userId = `usr-${crypto.randomUUID().slice(0, 8)}`;
    const userRole = role === 'driver' ? 'driver' : 'passenger';
    const validVehicleType =
      vehicle_type === 'moto' ? 'moto' : vehicle_type === 'delivery' ? 'delivery' : 'car';

    const newUser: StoredUser = {
      id: userId,
      role: userRole,
      status: userRole === 'driver' ? 'pending' : 'active',
      full_name: String(full_name).trim(),
      phone: String(phone).trim(),
      email: normalizedEmail,
      cpf: String(cpf).trim(),
      avatar_url: null,
      preferred_payment: 'pix',
      rating_avg: 5.0,
      rating_count: 0,
      wallet_balance: 0,
      is_anonymized: false,
      created_at: now,
      password_hash: hashPassword(String(password)),
      offers_seen: 0,
      offers_accepted: 0,
      rides_started: 0,
      rides_completed: 0,
      driver:
        userRole === 'driver'
          ? {
              user_id: userId,
              cnh_url: String(cnh_url),
              crlv_url: String(crlv_url),
              vehicle_type: validVehicleType,
              vehicle_model: String(vehicle_model).trim(),
              vehicle_plate: String(vehicle_plate).trim().toUpperCase(),
              vehicle_color: String(vehicle_color).trim(),
              pix_key: String(pix_key).trim(),
              is_online: false,
              current_lat: -23.55052,
              current_lng: -46.633308,
              heading: 0,
              acceptance_rate: 100,
              completion_rate: 100,
              updated_at: now,
            }
          : null,
    };

    db.users.push(newUser);
    saveDatabase();
    const safeUser = sanitizeUser(newUser);
    broadcast('user:created', safeUser);
    return res.status(201).json({ user: safeUser });
  });

  app.post('/api/auth/login', (req, res) => {
    const { email, password } = req.body;
    const normalizedEmail = String(email || '').trim().toLowerCase();
    const user = db.users.find((u) => u.email.toLowerCase() === normalizedEmail);
    if (!user || user.is_anonymized || user.password_hash !== hashPassword(String(password || ''))) {
      return res.status(401).json({ error: 'E-mail, senha inválidos ou conta encerrada.' });
    }
    return res.json({ user: sanitizeUser(user) });
  });

  app.get('/api/users/:id', (req, res) => {
    const user = db.users.find((u) => u.id === req.params.id && !u.is_anonymized);
    if (!user) {
      return res.status(404).json({ error: 'Usuário não encontrado.' });
    }
    return res.json({ user: sanitizeUser(user) });
  });

  // Update Profile, Saved Addresses, Payment & Vehicle Settings
  app.put('/api/users/:id/profile', (req, res) => {
    const user = db.users.find((u) => u.id === req.params.id && !u.is_anonymized);
    if (!user) return res.status(404).json({ error: 'Usuário não encontrado.' });

    const {
      full_name,
      phone,
      email,
      home_address,
      work_address,
      preferred_payment,
      vehicle_model,
      vehicle_plate,
      vehicle_color,
      vehicle_type,
      pix_key,
    } = req.body;

    if (full_name) user.full_name = String(full_name).trim();
    if (phone) user.phone = String(phone).trim();
    if (email) {
      const nextEmail = String(email).trim().toLowerCase();
      if (db.users.some((other) => other.id !== user.id && other.email.toLowerCase() === nextEmail)) {
        return res.status(409).json({ error: 'Este e-mail já está em uso por outra conta.' });
      }
      user.email = nextEmail;
    }
    if (home_address !== undefined) user.home_address = home_address;
    if (work_address !== undefined) user.work_address = work_address;
    if (preferred_payment && ['pix', 'cash', 'card_machine'].includes(preferred_payment)) {
      user.preferred_payment = preferred_payment;
    }

    if (user.driver) {
      if (vehicle_model) user.driver.vehicle_model = String(vehicle_model).trim();
      if (vehicle_plate) user.driver.vehicle_plate = String(vehicle_plate).trim().toUpperCase();
      if (vehicle_color) user.driver.vehicle_color = String(vehicle_color).trim();
      if (vehicle_type && ['car', 'moto', 'delivery'].includes(vehicle_type)) {
        user.driver.vehicle_type = vehicle_type;
      }
      if (pix_key) user.driver.pix_key = String(pix_key).trim();
      user.driver.updated_at = new Date().toISOString();
    }

    saveDatabase();
    const safe = sanitizeUser(user);
    broadcast('user:updated', safe);
    return res.json({ user: safe });
  });

  // Change Password
  app.post('/api/users/:id/password', (req, res) => {
    const user = db.users.find((u) => u.id === req.params.id && !u.is_anonymized);
    if (!user) return res.status(404).json({ error: 'Usuário não encontrado.' });

    const { current_password, new_password } = req.body;
    if (user.password_hash !== hashPassword(String(current_password || ''))) {
      return res.status(403).json({ error: 'Senha atual incorreta.' });
    }
    if (!new_password || String(new_password).length < 6) {
      return res.status(400).json({ error: 'A nova senha deve ter pelo menos 6 caracteres.' });
    }
    user.password_hash = hashPassword(String(new_password));
    saveDatabase();
    return res.json({ ok: true });
  });

  // LGPD Account Deletion / Anonymization
  app.delete('/api/users/:id/account', (req, res) => {
    const user = db.users.find((u) => u.id === req.params.id);
    if (!user) return res.status(404).json({ error: 'Usuário não encontrado.' });

    user.full_name = 'Usuário Anonimizado';
    user.phone = '(00) 00000-0000';
    user.email = `deleted_${user.id}@anon.local`;
    user.cpf = '000.000.000-00';
    user.avatar_url = null;
    user.home_address = null;
    user.work_address = null;
    user.status = 'suspended';
    user.is_anonymized = true;
    user.password_hash = hashPassword(crypto.randomUUID());

    if (user.driver) {
      user.driver.is_online = false;
      user.driver.cnh_url = '';
      user.driver.crlv_url = '';
      user.driver.vehicle_plate = 'REDACTED';
      user.driver.pix_key = 'REDACTED';
      user.driver.current_lat = null;
      user.driver.current_lng = null;
    }

    saveDatabase();
    broadcast('driver:status', sanitizeOnlineDriverPublic(user));
    return res.json({ ok: true });
  });

  app.post('/api/driver/online', (req, res) => {
    const { userId, is_online, lat, lng } = req.body;
    const user = db.users.find((u) => u.id === userId && u.role === 'driver' && !u.is_anonymized);
    if (!user || !user.driver) {
      return res.status(404).json({ error: 'Motorista não encontrado.' });
    }
    if (user.status !== 'active') {
      return res.status(403).json({
        error:
          user.status === 'pending'
            ? 'Seu cadastro ainda está em análise pelo Super Admin.'
            : 'Sua conta de motorista não está ativa para corridas.',
      });
    }

    user.driver.is_online = Boolean(is_online);
    if (typeof lat === 'number' && typeof lng === 'number') {
      user.driver.current_lat = lat;
      user.driver.current_lng = lng;
    }
    user.driver.updated_at = new Date().toISOString();
    saveDatabase();
    broadcast('driver:status', sanitizeOnlineDriverPublic(user));
    return res.json({ user: sanitizeUser(user) });
  });

  app.post('/api/driver/location', (req, res) => {
    const { userId, lat, lng, heading } = req.body;
    const user = db.users.find(
      (u) => u.id === userId && u.driver && u.status === 'active' && u.driver.is_online
    );
    if (!user || !user.driver) {
      return res.status(404).json({ error: 'Motorista offline ou não encontrado.' });
    }
    user.driver.current_lat = Number(lat);
    user.driver.current_lng = Number(lng);
    user.driver.heading = Number(heading || 0);
    user.driver.updated_at = new Date().toISOString();
    saveDatabase();
    broadcast('driver:location', {
      userId,
      lat: user.driver.current_lat,
      lng: user.driver.current_lng,
      heading: user.driver.heading,
    });
    return res.json({ ok: true });
  });

  app.post('/api/rides', (req, res) => {
    const {
      passenger_id,
      category,
      payment_method,
      origin_address,
      origin_lat,
      origin_lng,
      destination_address,
      destination_lat,
      destination_lng,
      distance_km: clientDistanceKm,
      delivery_notes,
    } = req.body;

    const passenger = db.users.find((u) => u.id === passenger_id && !u.is_anonymized);
    if (!passenger) {
      return res.status(404).json({ error: 'Cliente não encontrado.' });
    }

    const pricing = db.pricing.find((p) => p.category === category) || db.pricing[0];
    const dist =
      typeof clientDistanceKm === 'number' && clientDistanceKm > 0
        ? Number(clientDistanceKm.toFixed(2))
        : Math.max(0.8, haversineKm(origin_lat, origin_lng, destination_lat, destination_lng));

    const computedFare = Math.max(pricing.min_fare, pricing.base_fare + dist * pricing.per_km_rate);
    const fare = Number(computedFare.toFixed(2));
    const pin = String(Math.floor(1000 + Math.random() * 9000));

    const ride: Ride = {
      id: `ride-${crypto.randomUUID().slice(0, 8)}`,
      passenger_id,
      driver_id: null,
      category: category as RideCategory,
      payment_method,
      status: 'searching',
      origin_address: String(origin_address),
      origin_lat: Number(origin_lat),
      origin_lng: Number(origin_lng),
      destination_address: String(destination_address),
      destination_lat: Number(destination_lat),
      destination_lng: Number(destination_lng),
      distance_km: dist,
      estimated_fare: fare,
      final_fare: null,
      pin_code: pin,
      delivery_notes: delivery_notes ? String(delivery_notes).trim() : null,
      created_at: new Date().toISOString(),
      accepted_at: null,
      arrived_at: null,
      started_at: null,
      completed_at: null,
    };

    db.rides.unshift(ride);
    saveDatabase();
    const enriched = enrichRide(ride);
    broadcast('ride:created', enriched);
    return res.status(201).json({ ride: enriched });
  });

  app.post('/api/rides/:id/accept', (req, res) => {
    const { driver_id } = req.body;
    const ride = db.rides.find((r) => r.id === req.params.id);
    if (!ride) return res.status(404).json({ error: 'Solicitação não encontrada.' });
    if (ride.status !== 'searching') {
      return res.status(409).json({ error: 'Esta solicitação já foi aceita ou cancelada.' });
    }
    const driver = db.users.find(
      (u) =>
        u.id === driver_id &&
        u.role === 'driver' &&
        u.status === 'active' &&
        !u.is_anonymized &&
        u.driver?.is_online
    );
    if (!driver || !driver.driver) {
      return res.status(403).json({ error: 'Motorista precisa estar aprovado e Online.' });
    }

    driver.offers_seen = (driver.offers_seen || 0) + 1;
    driver.offers_accepted = (driver.offers_accepted || 0) + 1;
    driver.driver.acceptance_rate = Math.round(
      (driver.offers_accepted / driver.offers_seen) * 100
    );

    ride.driver_id = driver_id;
    ride.status = 'accepted';
    ride.accepted_at = new Date().toISOString();
    saveDatabase();

    const enriched = enrichRide(ride);
    broadcast('ride:updated', enriched);
    broadcast('user:updated', sanitizeUser(driver));
    return res.json({ ride: enriched });
  });

  app.post('/api/rides/:id/decline', (req, res) => {
    const { driver_id } = req.body;
    const driver = db.users.find((u) => u.id === driver_id && u.driver);
    if (driver && driver.driver) {
      driver.offers_seen = (driver.offers_seen || 0) + 1;
      driver.offers_accepted = driver.offers_accepted || 0;
      driver.driver.acceptance_rate = Math.round(
        (driver.offers_accepted / driver.offers_seen) * 100
      );
      saveDatabase();
      return res.json({ user: sanitizeUser(driver) });
    }
    return res.json({ ok: true });
  });

  app.post('/api/rides/:id/arrive', (req, res) => {
    const { driver_id } = req.body;
    const ride = db.rides.find((r) => r.id === req.params.id);
    if (!ride || ride.driver_id !== driver_id) {
      return res.status(404).json({ error: 'Corrida não encontrada.' });
    }
    ride.status = 'arrived';
    ride.arrived_at = new Date().toISOString();
    saveDatabase();
    const enriched = enrichRide(ride);
    broadcast('ride:updated', enriched);
    return res.json({ ride: enriched });
  });

  // Start Ride / Confirm Pickup (Always validates 4-digit PIN)
  app.post('/api/rides/:id/start', (req, res) => {
    const { driver_id, pin_code } = req.body;
    const ride = db.rides.find((r) => r.id === req.params.id);
    if (!ride || ride.driver_id !== driver_id) {
      return res.status(404).json({ error: 'Corrida não encontrada.' });
    }
    if (String(pin_code || '').trim() !== ride.pin_code) {
      return res.status(403).json({
        error:
          ride.category === 'delivery'
            ? 'Código PIN de coleta incorreto. Confirme os 4 dígitos com o remetente.'
            : 'Código PIN incorreto. Confirme os 4 dígitos com o passageiro.',
      });
    }
    const driver = db.users.find((u) => u.id === driver_id);
    if (driver && driver.driver) {
      driver.rides_started = (driver.rides_started || 0) + 1;
      driver.driver.completion_rate = Math.round(
        ((driver.rides_completed || 0) / driver.rides_started) * 100
      );
    }

    ride.status = 'in_progress';
    ride.started_at = new Date().toISOString();
    saveDatabase();
    const enriched = enrichRide(ride);
    broadcast('ride:updated', enriched);
    return res.json({ ride: enriched });
  });

  // Complete Ride / Delivery (For 'delivery', ALSO validates 4-digit PIN at destination!)
  app.post('/api/rides/:id/complete', (req, res) => {
    const { driver_id, pin_code } = req.body;
    const ride = db.rides.find((r) => r.id === req.params.id);
    if (!ride || ride.driver_id !== driver_id) {
      return res.status(404).json({ error: 'Corrida não encontrada.' });
    }
    if (ride.status === 'completed') {
      return res.json({ ride: enrichRide(ride) });
    }

    if (ride.category === 'delivery') {
      if (String(pin_code || '').trim() !== ride.pin_code) {
        return res.status(403).json({
          error: 'PIN de entrega incorreto. Peça o código de 4 dígitos no destino para concluir.',
        });
      }
    }

    ride.status = 'completed';
    ride.final_fare = ride.estimated_fare;
    ride.completed_at = new Date().toISOString();

    const driver = db.users.find((u) => u.id === driver_id);
    if (driver) {
      driver.wallet_balance = Number((driver.wallet_balance + ride.final_fare).toFixed(2));
      if (driver.driver) {
        driver.rides_completed = (driver.rides_completed || 0) + 1;
        const started = Math.max(driver.rides_started || 1, driver.rides_completed);
        driver.driver.completion_rate = Math.round((driver.rides_completed / started) * 100);
      }
      const tx: WalletTransaction = {
        id: `tx-${crypto.randomUUID().slice(0, 8)}`,
        user_id: driver.id,
        ride_id: ride.id,
        amount: ride.final_fare,
        type: 'ride_earning',
        description: `${ride.category === 'delivery' ? 'Entrega' : 'Corrida'} #${ride.id.slice(-4)} · ${ride.destination_address.split(',')[0]}`,
        created_at: new Date().toISOString(),
      };
      db.transactions.unshift(tx);
      broadcast('user:updated', sanitizeUser(driver));
    }

    saveDatabase();
    const enriched = enrichRide(ride);
    broadcast('ride:updated', enriched);
    return res.json({ ride: enriched });
  });

  app.post('/api/rides/:id/cancel', (req, res) => {
    const ride = db.rides.find((r) => r.id === req.params.id);
    if (!ride) return res.status(404).json({ error: 'Corrida não encontrada.' });
    if (ride.status === 'completed') {
      return res.status(400).json({ error: 'Não é possível cancelar uma corrida finalizada.' });
    }
    ride.status = 'cancelled';
    saveDatabase();
    const enriched = enrichRide(ride);
    broadcast('ride:updated', enriched);
    return res.json({ ride: enriched });
  });

  app.post('/api/rides/:id/rate', (req, res) => {
    const { from_user_id, to_user_id, stars } = req.body;
    const ride = db.rides.find((r) => r.id === req.params.id);
    if (!ride) return res.status(404).json({ error: 'Corrida não encontrada.' });
    const score = Math.min(5, Math.max(1, Number(stars) || 5));

    const target = db.users.find((u) => u.id === to_user_id);
    if (target) {
      const total = target.rating_avg * target.rating_count + score;
      target.rating_count += 1;
      target.rating_avg = Number((total / target.rating_count).toFixed(2));
      broadcast('user:updated', sanitizeUser(target));
    }

    if (from_user_id === ride.passenger_id) ride.passenger_rating_submitted = true;
    if (from_user_id === ride.driver_id) ride.driver_rating_submitted = true;

    saveDatabase();
    const enriched = enrichRide(ride);
    broadcast('ride:updated', enriched);
    return res.json({ ride: enriched });
  });

  app.get('/api/rides/:id/messages', (req, res) => {
    const msgs = db.messages.filter((m) => m.ride_id === req.params.id);
    res.json({ messages: msgs });
  });

  app.post('/api/rides/:id/messages', (req, res) => {
    const { sender_id, sender_name, content } = req.body;
    if (!content || !String(content).trim()) {
      return res.status(400).json({ error: 'Mensagem vazia.' });
    }
    const msg: RideMessage = {
      id: `msg-${crypto.randomUUID().slice(0, 8)}`,
      ride_id: req.params.id,
      sender_id: String(sender_id),
      sender_name: String(sender_name),
      content: String(content).trim(),
      created_at: new Date().toISOString(),
    };
    db.messages.push(msg);
    saveDatabase();
    broadcast('chat:message', msg);
    return res.status(201).json({ message: msg });
  });

  app.get('/api/wallet/:userId', (req, res) => {
    const user = db.users.find((u) => u.id === req.params.userId);
    if (!user) return res.status(404).json({ error: 'Usuário não encontrado.' });
    const txs = db.transactions.filter((t) => t.user_id === req.params.userId);
    res.json({ balance: user.wallet_balance, transactions: txs });
  });

  // --- ADMIN ROUTES ---
  app.get('/api/admin/overview', (_req, res) => {
    const completedRides = db.rides.filter((r) => r.status === 'completed');
    const totalRevenue = Number(
      completedRides.reduce((acc, r) => acc + (r.final_fare ?? r.estimated_fare), 0).toFixed(2)
    );
    res.json({
      users: db.users.map(sanitizeUser),
      rides: db.rides.map(enrichRide),
      pricing: db.pricing,
      transactions: db.transactions,
      metrics: {
        totalRevenue,
        completedCount: completedRides.length,
        activeRidesCount: db.rides.filter((r) =>
          ['searching', 'accepted', 'arrived', 'in_progress'].includes(r.status)
        ).length,
        pendingDriversCount: db.users.filter(
          (u) => u.role === 'driver' && u.status === 'pending' && !u.is_anonymized
        ).length,
      },
    });
  });

  app.post('/api/admin/drivers/:userId/review', (req, res) => {
    const { status, rejection_reason } = req.body;
    const driver = db.users.find((u) => u.id === req.params.userId && u.role === 'driver');
    if (!driver) return res.status(404).json({ error: 'Motorista não encontrado.' });

    if (!['active', 'rejected', 'suspended', 'pending'].includes(status)) {
      return res.status(400).json({ error: 'Status inválido.' });
    }

    driver.status = status;
    if (status !== 'active' && driver.driver) {
      driver.driver.is_online = false;
    }
    if (driver.driver) {
      driver.driver.rejection_reason = rejection_reason ? String(rejection_reason) : null;
      driver.driver.updated_at = new Date().toISOString();
    }
    saveDatabase();
    const safe = sanitizeUser(driver);
    broadcast('user:updated', safe);
    return res.json({ user: safe });
  });

  app.put('/api/admin/pricing', (req, res) => {
    const { pricing } = req.body as { pricing: PricingSetting[] };
    if (!Array.isArray(pricing)) {
      return res.status(400).json({ error: 'Formato inválido.' });
    }
    db.pricing = pricing.map((p) => ({
      ...p,
      base_fare: Math.max(0, Number(p.base_fare)),
      per_km_rate: Math.max(0, Number(p.per_km_rate)),
      min_fare: Math.max(0, Number(p.min_fare)),
    }));
    saveDatabase();
    broadcast('pricing:updated', db.pricing);
    return res.json({ pricing: db.pricing });
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Velo99 server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
