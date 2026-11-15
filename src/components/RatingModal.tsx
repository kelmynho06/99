import React, { useState } from 'react';
import { Star } from 'lucide-react';
import { formatBRL } from '../lib/geo';
import type { Ride, UserProfile } from '../types/mobility';

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
  const [stars, setStars] = useState(5);
  const [submitting, setSubmitting] = useState(false);

  const isPassenger = currentUser.id === ride.passenger_id;
  const targetUser = isPassenger ? ride.driver : ride.passenger;
  const targetId = isPassenger ? ride.driver_id : ride.passenger_id;

  const submitRating = async () => {
    if (!targetId || submitting) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/rides/${ride.id}/rate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from_user_id: currentUser.id,
          to_user_id: targetId,
          stars,
        }),
      });
      if (res.ok) {
        const data = (await res.json()) as { ride: Ride };
        onSubmitted(data.ride);
      } else {
        onSkip();
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[1150] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-3xl bg-white p-6 shadow-2xl text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-[#FFCC00] text-neutral-950 font-extrabold text-xl">
          99
        </div>
        <h3 className="mt-4 text-xl font-extrabold text-neutral-950">Corrida finalizada!</h3>
        <p className="mt-1 text-sm text-neutral-600">
          Valor total:{' '}
          <span className="font-bold text-neutral-950 font-mono-num">
            {formatBRL(ride.final_fare ?? ride.estimated_fare)}
          </span>
        </p>

        <div className="mt-5 rounded-2xl bg-neutral-50 p-4 border border-neutral-100">
          <p className="text-xs font-medium text-neutral-500">
            Como foi sua experiência com {targetUser?.full_name || (isPassenger ? 'o motorista' : 'o passageiro')}?
          </p>
          <div className="mt-3 flex items-center justify-center gap-2">
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
                    n <= stars ? 'fill-[#FFCC00] text-[#F59E0B]' : 'text-neutral-300'
                  }`}
                />
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs font-bold text-neutral-800">{stars} de 5 estrelas</p>
        </div>

        <button
          type="button"
          onClick={submitRating}
          disabled={submitting}
          className="mt-5 min-h-[48px] w-full rounded-2xl bg-neutral-950 text-sm font-bold text-[#FFCC00] shadow-lg transition active:scale-[0.98]"
        >
          {submitting ? 'Enviando avaliação...' : 'Enviar Avaliação'}
        </button>

        <button
          type="button"
          onClick={onSkip}
          className="mt-2 min-h-[44px] w-full text-xs font-semibold text-neutral-500 hover:text-neutral-800"
        >
          Avaliar depois
        </button>
      </div>
    </div>
  );
};
