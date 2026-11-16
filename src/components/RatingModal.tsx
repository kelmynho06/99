import React, { useState } from 'react';
import { Star, X } from 'lucide-react';
import { useAppConfig } from '../context/AppConfigContext';
import { resolveBrandLogo } from '../lib/brandAssets';
import { formatBRL } from '../lib/geo';
import { submitRideRating } from '../lib/mobilityApi';
import type { PlatformConfig, Ride, UserProfile } from '../types/mobility';
import { AvatarImage } from './AvatarImage';

interface RatingModalProps {
  ride: Ride;
  currentUser: UserProfile;
  onSubmitted: (updatedRide: Ride) => void;
  onSkip: () => void;
}

export const RatingModal: React.FC<RatingModalProps> = ({
  ride,
  currentUser,
  onSubmitted,
  onSkip,
}) => {
  const { config: appConfig } = useAppConfig();
  const [stars, setStars] = useState(5);
  const [submitting, setSubmitting] = useState(false);

  const isPassenger = currentUser.id === ride.passenger_id;
  const targetUser = isPassenger ? ride.driver : ride.passenger;
  const targetId = isPassenger ? ride.driver_id : ride.passenger_id;
  const brandLogo = resolveBrandLogo({ app_logo_url: appConfig.logo_url } as PlatformConfig);

  const submitRating = async () => {
    if (!targetId || submitting) return;
    setSubmitting(true);
    try {
      const updated = await submitRideRating(ride, currentUser.id, targetId, stars);
      onSubmitted(updated);
    } catch {
      onSkip();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[1150] flex items-center justify-center bg-black/55 p-4">
      <div className="relative w-full max-w-sm rounded-3xl bg-white dark:bg-neutral-900 p-6 shadow-2xl text-center border border-neutral-100 dark:border-neutral-800">
        <button
          type="button"
          onClick={onSkip}
          className="absolute top-4 right-4 flex h-9 w-9 items-center justify-center rounded-full bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-300 hover:bg-neutral-200 dark:hover:bg-neutral-700 transition"
          aria-label="Fechar avaliação"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="flex items-center justify-center gap-2">
          <img
            src={brandLogo}
            alt={appConfig.app_name}
            className="h-12 w-12 rounded-2xl object-cover border border-neutral-200 dark:border-neutral-700 shadow-xs"
          />
        </div>

        <h3 className="mt-3.5 font-display text-xl font-extrabold text-neutral-950 dark:text-white">
          Corrida finalizada!
        </h3>
        <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
          Valor total:{' '}
          <span className="font-bold text-neutral-950 dark:text-white font-mono-num">
            {formatBRL(ride.final_fare ?? ride.estimated_fare)}
          </span>
        </p>

        <div className="mt-4 rounded-2xl bg-neutral-50 dark:bg-neutral-800/70 p-4 border border-neutral-200/70 dark:border-neutral-700">
          <div className="flex flex-col items-center gap-2 mb-2">
            <AvatarImage
              src={targetUser?.avatar_url}
              name={targetUser?.full_name || (isPassenger ? 'Motorista' : 'Passageiro')}
              className="h-14 w-14 rounded-full object-cover border-2 border-[#FFD100] shadow-xs"
              fallbackClassName="flex h-14 w-14 items-center justify-center rounded-full bg-neutral-950 text-[#FFD100] font-extrabold text-lg"
            />
            <p className="text-xs font-medium text-neutral-600 dark:text-neutral-300">
              Como foi sua experiência com{' '}
              <strong className="text-neutral-950 dark:text-white">
                {targetUser?.full_name || (isPassenger ? 'o motorista' : 'o passageiro')}
              </strong>
              ?
            </p>
          </div>
          <div className="mt-2 flex items-center justify-center gap-2">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setStars(n)}
                className="flex h-11 w-11 items-center justify-center rounded-xl transition active:scale-90"
                aria-label={`${n} estrelas`}
              >
                <Star
                  className={`h-8 w-8 ${
                    n <= stars ? 'fill-[#FFD100] text-[#F59E0B]' : 'text-neutral-300 dark:text-neutral-600'
                  }`}
                />
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-xs font-bold text-neutral-800 dark:text-neutral-200">{stars} de 5 estrelas</p>
        </div>

        <button
          type="button"
          onClick={submitRating}
          disabled={submitting}
          className="mt-5 min-h-[48px] w-full rounded-2xl bg-[#FFD100] text-sm font-extrabold text-neutral-950 shadow-sm transition active:scale-[0.98]"
        >
          {submitting ? 'Enviando avaliação...' : 'Enviar Avaliação'}
        </button>

        <button
          type="button"
          onClick={onSkip}
          className="mt-2 min-h-[42px] w-full text-xs font-semibold text-neutral-500 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-white"
        >
          Avaliar depois
        </button>
      </div>
    </div>
  );
};
