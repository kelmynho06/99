import goDriverBrandLogo from '../assets/images/go_driver_logo_1795615132360.jpg';
import veloCarPopImg from '../assets/images/velo_car_pop_1794857333460.jpg';
import veloDeliveryCarImg from '../assets/images/velo_delivery_car_1794857334048.jpg';
import veloDeliveryMotoImg from '../assets/images/velo_delivery_moto_1794857334549.jpg';
import veloMotoUrbanImg from '../assets/images/velo_moto_urban_1794857333529.jpg';
import type { PlatformConfig, RideCategory } from '../types/mobility';

export const DEFAULT_BRAND_LOGO = goDriverBrandLogo;

export const DEFAULT_VEHICLE_IMAGES: Record<RideCategory, string> = {
  moto: veloMotoUrbanImg,
  pop: veloCarPopImg,
  negocia: veloCarPopImg,
  delivery_moto: veloDeliveryMotoImg,
  delivery_car: veloDeliveryCarImg,
};

export function resolveBrandLogo(config?: PlatformConfig | null): string {
  const raw = config?.app_logo_url?.trim();
  if (!raw) return DEFAULT_BRAND_LOGO;
  const lower = raw.toLowerCase();
  if (
    lower.includes('mobilidade66_logo') ||
    lower.includes('boreal_brand_logo') ||
    lower.includes('velo_brand_icon')
  ) {
    return DEFAULT_BRAND_LOGO;
  }
  return raw;
}

export function resolveCategoryVehicleImage(
  category: RideCategory,
  config?: PlatformConfig | null
): string {
  if (category === 'moto') {
    return config?.vehicle_img_moto || DEFAULT_VEHICLE_IMAGES.moto;
  }
  if (category === 'pop' || category === 'negocia') {
    return config?.vehicle_img_pop || DEFAULT_VEHICLE_IMAGES.pop;
  }
  if (category === 'delivery_moto') {
    return config?.vehicle_img_delivery_moto || DEFAULT_VEHICLE_IMAGES.delivery_moto;
  }
  return config?.vehicle_img_delivery_car || DEFAULT_VEHICLE_IMAGES.delivery_car;
}
