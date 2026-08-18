"use client";

import Image, { type ImageLoaderProps } from "next/image";
import { useEffect, useState } from "react";
import styles from "../AdminDashboard.module.css";

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

type ProductThumbProps = {
  name: string;
  imageUrl: string | null;
  large?: boolean;
};

export function ProductThumb({ name, imageUrl, large = false }: ProductThumbProps) {
  const [failed, setFailed] = useState(false);
  const usableImageUrl = safeSource(imageUrl);

  useEffect(() => {
    setFailed(false);
  }, [usableImageUrl]);

  const className = large
    ? `${styles.productThumb} ${styles.productThumbLarge}`
    : styles.productThumb;

  return (
    <div className={className}>
      {usableImageUrl && !failed ? (
        <Image
          loader={passthroughLoader}
          src={usableImageUrl}
          alt={name}
          fill
          sizes={large ? "(max-width: 720px) 100vw, 520px" : "96px"}
          unoptimized
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
        />
      ) : (
        <span role="img" aria-label={`Brak zdjęcia produktu: ${name}`}>
          {name.slice(0, 1).toUpperCase() || "F"}
        </span>
      )}
    </div>
  );
}
