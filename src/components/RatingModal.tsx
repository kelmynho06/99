import React, { useEffect, useState } from 'react';
import { Bike, Car, Package, ShieldCheck, Star, X } from 'lucide-react';
import { useAppConfig } from '../context/AppConfigContext';
import { resolveBrandLogo } from '../lib/brandAssets';
import { formatBRL } from '../lib/geo';
import { useTranslation } from '../lib/i18n';
import {
  fetchUserProfileById,
  resolveDocumentDisplayUrl,
  submitRideRating,
} from '../lib/mobilityApi';
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
  const { t } = useTranslation();
  const [stars, setStars] = useState(5);
  const [submitting, setSubmitting] = useState(false);
  const [fetchedTarget, setFetchedTarget] = useState<UserProfile | null>(null);
  const [resolvedAvatarUrl, setResolvedAvatarUrl] = useState<string | null>(null);

  const isPassengerEvaluatingDriver = currentUser.id === ride.passenger_id;
  const embeddedTarget = isPassengerEvaluatingDriver ? ride.driver : ride.passenger;
  const targetId = isPassengerEvaluatingDriver ? ride.driver_id : ride.passenger_id;
  const targetUser = fetchedTarget || embeddedTarget || null;
  const isDelivery =
    ride.category === 'delivery_moto' || ride.category === 'delivery_car';

  useEffect(() => {
    let cancelled = false;
    if (!targetId) return;
    const needsProfileFetch =
      !embeddedTarget?.full_name ||
      !embeddedTarget?.avatar_url ||
      (isPassengerEvaluatingDriver && !embeddedTarget?.driver);

    if (needsProfileFetch) {
      fetchUserProfileById(targetId)
        .then(async (fresh) => {
          if (cancelled || !fresh) return;
          setFetchedTarget(fresh);
          if (fresh.avatar_url) {
            const resolved = await resolveDocumentDisplayUrl(fresh.avatar_url).catch(
              () => fresh.avatar_url || null
            );
            if (!cancelled) setResolvedAvatarUrl(resolved);
          }
        })
        .catch(() => {});
    } else if (embeddedTarget?.avatar_url) {
      resolveDocumentDisplayUrl(embeddedTarget.avatar_url)
        .then((url) => {
          if (!cancelled) setResolvedAvatarUrl(url);
        })
        .catch(() => {
          if (!cancelled) setResolvedAvatarUrl(embeddedTarget.avatar_url || null);
        });
    }
    return () => {
      cancelled = true;
    };
  }, [targetId, embeddedTarget, isPassengerEvaluatingDriver]);

  const roleBadgeLabel = isPassengerEvaluatingDriver
    ? isDelivery
      ? t.deliverer_role_badge
      : t.driver_role_badge
    : t.passenger_role_badge;

  const headingTitle = isPassengerEvaluatingDriver
    ? isDelivery
      ? t.rate_deliverer_title
      : t.rate_driver_title
    : t.rate_passenger_title;

  const targetFullName =
    targetUser?.full_name || roleBadgeLabel;
  const targetAvatarSrc = resolvedAvatarUrl || targetUser?.avatar_url || null;
  const driverMeta = isPassengerEvaluatingDriver ? targetUser?.driver : undefined;
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
    <div className="fixed inset-0 z-[1150] flex items-center justify-center bg-black/65 backdrop-blur-xs p-4">
      <div className="relative w-full max-w-sm rounded-3xl bg-white dark:bg-neutral-900 p-6 shadow-2xl text-center border border-neutral-200 dark:border-neutral-800">
        <button
          type="button"
          onClick={onSkip}
          className="absolute top-4 right-4 flex h-9 w-9 items-center justify-center rounded-full bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-300 hover:bg-neutral-200 dark:hover:bg-neutral-700 transition"
          aria-label={t.close}
        >
          <X className="h-4 w-4" />
        </button>

        <div className="flex items-center justify-center gap-2">
          <img
            src={brandLogo}
            alt={appConfig.app_name}
            className="h-11 w-11 rounded-2xl object-cover border border-neutral-200 dark:border-neutral-700 shadow-xs"
          />
        </div>

        <h3 className="mt-3 font-display text-xl font-extrabold text-neutral-950 dark:text-white">
          {headingTitle}
        </h3>
        <p className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
          {formatBRL(ride.final_fare ?? ride.estimated_fare)}
        </p>

        {/* Evaluated Person Identification Card */}
        <div className="mt-4 rounded-2xl bg-neutral-50 dark:bg-neutral-800/80 p-4 border border-neutral-200 dark:border-neutral-700 space-y-3">
          <p className="text-[11px] font-bold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
            {t.evaluating_person_label}
          </p>

          <div className="flex items-center gap-3 text-left rounded-2xl bg-white dark:bg-neutral-900 p-3 border border-neutral-200/80 dark:border-neutral-700 shadow-xs">
            <AvatarImage
              src={targetAvatarSrc}
              name={targetFullName}
              className="h-16 w-16 rounded-2xl object-cover border-2 border-[#2DD4BF] shrink-0 shadow-xs"
              fallbackClassName="flex h-16 w-16 items-center justify-center rounded-2xl bg-[#047857] text-[#6EE7B7] font-extrabold text-xl shrink-0"
            />
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="inline-flex items-center gap-1 rounded-lg bg-[#ECFDF5] dark:bg-emerald-950/60 px-2 py-0.5 text-[10px] font-extrabold text-[#047857] dark:text-[#6EE7B7] uppercase border border-[#6EE7B7]/50">
                  {isDelivery ? (
                    <Package className="h-3 w-3" />
                  ) : driverMeta?.vehicle_type === 'moto' ? (
                    <Bike className="h-3 w-3" />
                  ) : isPassengerEvaluatingDriver ? (
                    <Car className="h-3 w-3" />
                  ) : (
                    <ShieldCheck className="h-3 w-3" />
                  )}
                  {roleBadgeLabel}
                </span>
                {typeof targetUser?.rating_avg === 'number' && (
                  <span className="inline-flex items-center gap-0.5 text-[11px] font-mono-num font-bold text-neutral-700 dark:text-neutral-300">
                    <Star className="h-3 w-3 fill-[#047857] text-[#047857] dark:fill-[#6EE7B7] dark:text-[#6EE7B7]" />
                    {targetUser.rating_avg.toFixed(1)}
                  </span>
                )}
              </div>

              <p className="font-display text-base font-extrabold text-neutral-950 dark:text-white truncate leading-tight">
                {targetFullName}
              </p>

              {driverMeta && (
                <div className="flex items-center gap-1.5 flex-wrap text-[11px] text-neutral-600 dark:text-neutral-300">
                  <span className="font-semibold truncate">
                    {driverMeta.vehicle_color} {driverMeta.vehicle_model}
                  </span>
                  {driverMeta.vehicle_plate && (
                    <span className="rounded-md bg-[#0F2421] dark:bg-neutral-800 px-1.5 py-0.5 font-mono-num text-[10px] font-extrabold text-[#6EE7B7] border border-[#047857]/40">
                      {driverMeta.vehicle_plate}
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* 5-Star Picker */}
          <div className="pt-1 flex items-center justify-center gap-1.5">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setStars(n)}
                className="flex h-11 w-11 items-center justify-center rounded-xl transition active:scale-90 hover:bg-white dark:hover:bg-neutral-900"
                aria-label={`${n} estrelas`}
              >
                <Star
                  className={`h-8 w-8 transition ${
                    n <= stars
                      ? 'fill-[#2DD4BF] text-[#047857] drop-shadow-xs'
                      : 'text-neutral-300 dark:text-neutral-600'
                  }`}
                />
              </button>
            ))}
          </div>
          <p className="text-xs font-extrabold text-neutral-900 dark:text-white font-mono-num">
            {stars} / 5 ★
          </p>
        </div>

        <button
          type="button"
          onClick={submitRating}
          disabled={submitting}
          className="aurora-accent-flow mt-5 min-h-[50px] w-full rounded-2xl text-sm font-extrabold text-white shadow-sm transition active:scale-[0.98]"
        >
          {submitting ? t.saving : t.submit_rating}
        </button>

        <button
          type="button"
          onClick={onSkip}
          className="mt-2 min-h-[40px] w-full text-xs font-semibold text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white"
        >
          {t.skip_rating}
        </button>
      </div>
    </div>
  );
};
