"use client";

import { useEffect, useState, type FormEvent } from "react";
import type { AdminAuction, AuctionDefinitionInput } from "../types";
import { formatMoney, slugify } from "../utils";
import styles from "../AdminDashboard.module.css";
import { ProductThumb } from "./ProductThumb";

type Draft = {
  slug: string;
  productName: string;
  productImageUrl: string;
  regularPrice: string;
  startPrice: string;
  floorPrice: string;
  durationMinutes: string;
  startsAt: string;
};

const EMPTY_DRAFT: Draft = {
  slug: "",
  productName: "",
  productImageUrl: "",
  regularPrice: "999",
  startPrice: "749",
  floorPrice: "699",
  durationMinutes: "10",
  startsAt: "",
};

type AuctionEditorProps = {
  editingAuction: AdminAuction | null;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (
    input: AuctionDefinitionInput,
    editingAuctionId: string | null,
  ) => Promise<boolean>;
};

function draftFromAuction(auction: AdminAuction): Draft {
  return {
    slug: auction.slug,
    productName: auction.productName,
    productImageUrl: auction.productImageUrl ?? "",
    regularPrice: String(auction.regularPrice),
    startPrice: String(auction.startPrice),
    floorPrice: String(auction.floorPrice),
    durationMinutes: String(auction.durationMinutes),
    startsAt: "",
  };
}

function validImageValue(value: string) {
  if (!value) return true;
  if (value.startsWith("/") && !value.startsWith("//")) return true;

  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

export function AuctionEditor({
  editingAuction,
  busy,
  onCancel,
  onSubmit,
}: AuctionEditorProps) {
  const editingAuctionId = editingAuction?.auctionId ?? null;
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [slugTouched, setSlugTouched] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setDraft(editingAuction ? draftFromAuction(editingAuction) : EMPTY_DRAFT);
    setSlugTouched(Boolean(editingAuction));
    setError("");
  }, [editingAuctionId]);

  const update = (field: keyof Draft, value: string) => {
    setError("");
    setDraft((current) => ({ ...current, [field]: value }));
  };

  const handleNameChange = (value: string) => {
    setError("");
    setDraft((current) => ({
      ...current,
      productName: value,
      ...(!slugTouched ? { slug: slugify(value) } : {}),
    }));
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;

    const productName = draft.productName.trim();
    const slug = draft.slug.trim();
    const productImageUrl = draft.productImageUrl.trim();
    const regularPrice = Number(draft.regularPrice);
    const startPrice = Number(draft.startPrice);
    const floorPrice = Number(draft.floorPrice);
    const durationMinutes = Number(draft.durationMinutes);

    const failValidation = (message: string, fieldId: string) => {
      setError(message);
      window.requestAnimationFrame(() => document.getElementById(fieldId)?.focus());
    };

    if (productName.length < 2 || productName.length > 80) {
      failValidation("Nazwa produktu musi mieć od 2 do 80 znaków.", "product-name");
      return;
    }
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 60) {
      failValidation(
        "Slug może zawierać małe litery, cyfry i pojedyncze myślniki.",
        "auction-slug",
      );
      return;
    }
    if (!validImageValue(productImageUrl) || productImageUrl.length > 500) {
      failValidation(
        "Zdjęcie musi mieć bezpieczny adres HTTPS albo lokalną ścieżkę zaczynającą się od /.",
        "product-image",
      );
      return;
    }
    if (
      !Number.isInteger(regularPrice) ||
      !Number.isInteger(startPrice) ||
      !Number.isInteger(floorPrice) ||
      regularPrice < startPrice ||
      startPrice <= floorPrice ||
      floorPrice < 2 ||
      regularPrice > 100_000
    ) {
      failValidation(
        "Ceny muszą być pełnymi kwotami: regularna ≥ startowa > minimalna (minimum 2 zł).",
        "regular-price",
      );
      return;
    }
    if (!Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 120) {
      failValidation("Czas trwania musi wynosić od 1 do 120 minut.", "duration");
      return;
    }

    let startsAt: string | undefined;
    if (!editingAuction && draft.startsAt) {
      const startTime = new Date(draft.startsAt).getTime();
      if (!Number.isFinite(startTime) || startTime <= Date.now()) {
        failValidation("Planowany start musi przypadać w przyszłości.", "starts-at");
        return;
      }
      startsAt = new Date(startTime).toISOString();
    }

    setError("");
    const saved = await onSubmit(
      {
        auctionId: slug,
        slug,
        productName,
        productImageUrl: productImageUrl || null,
        regularPrice,
        startPrice,
        floorPrice,
        durationMinutes,
        ...(startsAt ? { startsAt } : {}),
      },
      editingAuctionId,
    );

    if (saved && !editingAuction) {
      setDraft(EMPTY_DRAFT);
      setSlugTouched(false);
    }
  };

  const parsedStartPrice = Number(draft.startPrice);
  const parsedFloorPrice = Number(draft.floorPrice);
  const parsedDuration = Number(draft.durationMinutes);

  return (
    <section className={styles.panelSection} id="auction-editor" aria-labelledby="editor-heading">
      <div className={styles.sectionHeader}>
        <div>
          <p className={styles.eyebrow}>{editingAuction ? "Edycja" : "Kreator"}</p>
          <h2 id="editor-heading" className={styles.focusHeading} tabIndex={-1}>
            {editingAuction ? `Edytuj: ${editingAuction.productName}` : "Nowa aukcja"}
          </h2>
        </div>
        {editingAuction ? (
          <button className={styles.ghostButton} type="button" onClick={onCancel} disabled={busy}>
            Anuluj
          </button>
        ) : null}
      </div>

      <form className={styles.editorLayout} onSubmit={handleSubmit} noValidate aria-busy={busy}>
        <fieldset
          className={styles.formFields}
          disabled={busy}
          aria-describedby={error ? "auction-editor-error" : undefined}
        >
          <legend className={styles.srOnly}>Dane aukcji</legend>
          <div className={styles.formGrid}>
            <label className={`${styles.field} ${styles.fieldWide}`} htmlFor="product-name">
              <span>Nazwa produktu</span>
              <input
                id="product-name"
                className={styles.input}
                type="text"
                value={draft.productName}
                onChange={(event) => handleNameChange(event.target.value)}
                maxLength={80}
                placeholder="np. Konsola PlayStation 5"
                required
              />
            </label>

            <label className={`${styles.field} ${styles.fieldWide}`} htmlFor="auction-slug">
              <span>Slug aukcji</span>
              <div className={styles.prefixedInput}>
                <span aria-hidden="true">/</span>
                <input
                  id="auction-slug"
                  className={styles.input}
                  type="text"
                  value={draft.slug}
                  onChange={(event) => {
                    if (editingAuction) return;
                    setSlugTouched(true);
                    update("slug", slugify(event.target.value));
                  }}
                  readOnly={Boolean(editingAuction)}
                  aria-readonly={Boolean(editingAuction)}
                  maxLength={60}
                  pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
                  placeholder="playstation-5"
                  required
                />
              </div>
              <small>
                {editingAuction
                  ? "Slug jest stałym identyfikatorem i nie można go zmienić po utworzeniu aukcji."
                  : "Krótki identyfikator bez spacji i polskich znaków."}
              </small>
            </label>

            <label className={`${styles.field} ${styles.fieldWide}`} htmlFor="product-image">
              <span>Adres zdjęcia</span>
              <input
                id="product-image"
                className={styles.input}
                type="text"
                value={draft.productImageUrl}
                onChange={(event) => update("productImageUrl", event.target.value)}
                maxLength={500}
                placeholder="https://…/produkt.jpg"
              />
              <small>Opcjonalny adres HTTPS. Bez zdjęcia portal pokaże elegancki placeholder.</small>
            </label>

            <label className={styles.field} htmlFor="regular-price">
              <span>Cena regularna</span>
              <div className={styles.suffixedInput}>
                <input
                  id="regular-price"
                  className={styles.input}
                  type="number"
                  min="2"
                  max="100000"
                  step="1"
                  inputMode="numeric"
                  value={draft.regularPrice}
                  onChange={(event) => update("regularPrice", event.target.value)}
                  required
                />
                <span>zł</span>
              </div>
            </label>

            <label className={styles.field} htmlFor="start-price">
              <span>Cena startowa</span>
              <div className={styles.suffixedInput}>
                <input
                  id="start-price"
                  className={styles.input}
                  type="number"
                  min="2"
                  max="100000"
                  step="1"
                  inputMode="numeric"
                  value={draft.startPrice}
                  onChange={(event) => update("startPrice", event.target.value)}
                  required
                />
                <span>zł</span>
              </div>
            </label>

            <label className={styles.field} htmlFor="floor-price">
              <span>Cena minimalna</span>
              <div className={styles.suffixedInput}>
                <input
                  id="floor-price"
                  className={styles.input}
                  type="number"
                  min="2"
                  max="99999"
                  step="1"
                  inputMode="numeric"
                  value={draft.floorPrice}
                  onChange={(event) => update("floorPrice", event.target.value)}
                  required
                />
                <span>zł</span>
              </div>
            </label>

            <label className={styles.field} htmlFor="duration">
              <span>Czas trwania</span>
              <div className={styles.suffixedInput}>
                <input
                  id="duration"
                  className={styles.input}
                  type="number"
                  min="1"
                  max="120"
                  step="1"
                  inputMode="numeric"
                  value={draft.durationMinutes}
                  onChange={(event) => update("durationMinutes", event.target.value)}
                  required
                />
                <span>min</span>
              </div>
            </label>

            {!editingAuction ? (
              <label className={`${styles.field} ${styles.fieldWide}`} htmlFor="starts-at">
                <span>Planowany start</span>
                <input
                  id="starts-at"
                  className={styles.input}
                  type="datetime-local"
                  value={draft.startsAt}
                  onChange={(event) => update("startsAt", event.target.value)}
                />
                <small>Puste pole oznacza najbliższy start wyznaczony przez serwer.</small>
              </label>
            ) : null}
          </div>
        </fieldset>

        <aside className={styles.editorPreview} aria-label="Podgląd aukcji">
          <ProductThumb
            name={draft.productName || "Fiszy"}
            imageUrl={draft.productImageUrl.trim() || null}
            large
          />
          <div className={styles.previewContent}>
            <span className={styles.previewLabel}>Podgląd</span>
            <strong>{draft.productName || "Nazwa produktu"}</strong>
            <p>
              {Number.isFinite(parsedStartPrice) ? formatMoney(parsedStartPrice) : "—"}
              <span aria-hidden="true"> → </span>
              {Number.isFinite(parsedFloorPrice) ? formatMoney(parsedFloorPrice) : "—"}
              <br />
              przez {Number.isFinite(parsedDuration) ? parsedDuration : "—"} min
            </p>
          </div>
        </aside>

        {error ? (
          <p className={styles.errorNotice} id="auction-editor-error" role="alert">
            {error}
          </p>
        ) : null}

        <div className={styles.editorActions}>
          <button className={styles.primaryButton} type="submit" disabled={busy} aria-busy={busy}>
            {busy
              ? "ZAPISUJĘ…"
              : editingAuction
                ? "ZAPISZ ZMIANY"
                : draft.startsAt
                  ? "UTWÓRZ I ZAPLANUJ"
                  : "UTWÓRZ AUKCJĘ"}
          </button>
        </div>
      </form>
    </section>
  );
}
