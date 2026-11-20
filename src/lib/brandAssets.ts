import borealBrandLogo from '../assets/images/boreal_brand_logo.png';
import veloCarPopImg from '../assets/images/velo_car_pop_1794857333460.jpg';
import veloDeliveryCarImg from '../assets/images/velo_delivery_car_1794857334048.jpg';
import veloDeliveryMotoImg from '../assets/images/velo_delivery_moto_1794857334549.jpg';
import veloMotoUrbanImg from '../assets/images/velo_moto_urban_1794857333529.jpg';
import type { PlatformConfig, RideCategory } from '../types/mobility';

export const DEFAULT_BRAND_LOGO = borealBrandLogo;

export const DEFAULT_VEHICLE_IMAGES: Record<RideCategory, string> = {
  moto: veloMotoUrbanImg,
  pop: veloCarPopImg,
  negocia: veloCarPopImg,
  delivery_moto: veloDeliveryMotoImg,
  delivery_car: veloDeliveryCarImg,
};

export function resolveBrandLogo(config?: PlatformConfig | null): string {
  return config?.app_logo_url || DEFAULT_BRAND_LOGO;
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
