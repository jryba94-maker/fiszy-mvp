"use client";

import Image, { type ImageLoaderProps } from "next/image";
import { useState } from "react";
import styles from "./public.module.css";

type SafeAuctionImageProps = {
  src: string | null;
  alt: string;
  priority?: boolean;
  sizes?: string;
  frameClassName?: string;
};

function passthroughLoader({ src }: ImageLoaderProps) {
  return src;
}

function safeSource(value: string | null) {
  if (!value || value.includes("\\")) return null;
  if (value.startsWith("/") && !value.startsWith("//")) return value;

  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && !parsed.username && !parsed.password
      ? parsed.toString()
      : null;
  } catch {
    return null;
  }
}

export function SafeAuctionImage({
  src,
  alt,
  priority = false,
  sizes = "(max-width: 760px) 100vw, 50vw",
  frameClassName,
}: SafeAuctionImageProps) {
  const usableSrc = safeSource(src);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const failed = Boolean(usableSrc && failedSrc === usableSrc);

  return (
    <div className={`${styles.imageFrame} ${frameClassName ?? ""}`}>
      {usableSrc && !failed ? (
        <Image
          className={styles.image}
          loader={passthroughLoader}
          src={usableSrc}
          alt={alt}
          fill
          sizes={sizes}
          priority={priority}
          unoptimized
          referrerPolicy="no-referrer"
          onError={() => setFailedSrc(usableSrc)}
        />
      ) : (
        <div className={styles.imageFallback} role="img" aria-label={`Brak zdjęcia produktu: ${alt}`}>
          {alt}
        </div>
      )}
    </div>
  );
}
