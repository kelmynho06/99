import React, { useEffect, useState } from 'react';
import { resolveDocumentDisplayUrl } from '../lib/mobilityApi';

interface AvatarImageProps {
  src?: string | null;
  name: string;
  className?: string;
  fallbackClassName?: string;
  initialsCount?: number;
}

export const AvatarImage: React.FC<AvatarImageProps> = ({
  src,
  name,
  className = 'h-12 w-12 rounded-full object-cover border-2 border-[#2563EB] shrink-0',
  fallbackClassName = 'flex h-12 w-12 items-center justify-center rounded-full bg-[#2563EB] text-white font-bold shrink-0',
  initialsCount = 1,
}) => {
  const [resolvedUrl, setResolvedUrl] = useState<string>('');
  const [failed, setFailed] = useState<boolean>(false);

  useEffect(() => {
    let active = true;
    setFailed(false);
    if (!src) {
      setResolvedUrl('');
      return;
    }
    if (src.startsWith('data:') || src.startsWith('blob:')) {
      setResolvedUrl(src);
      return;
    }
    resolveDocumentDisplayUrl(src)
      .then((url) => {
        if (active) setResolvedUrl(url || src);
      })
      .catch(() => {
        if (active) setResolvedUrl(src);
      });
    return () => {
      active = false;
    };
  }, [src]);

  const initials = (name || 'U').trim().slice(0, initialsCount).toUpperCase() || 'U';

  if (!resolvedUrl || failed) {
    return <div className={fallbackClassName}>{initials}</div>;
  }

  return (
    <img
      src={resolvedUrl}
      alt={name}
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className={className}
    />
  );
};
