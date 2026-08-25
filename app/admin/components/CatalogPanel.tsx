"use client";

import { useCallback, useEffect, useState } from "react";
import styles from "../AdminDashboard.module.css";

type Product = {
  productId: string;
  sku: string;
  name: string;
  description: string;
  imageUrls: string[];
  category: "electronics" | "home" | "sport" | "beauty" | "gaming" | "other";
  status: "draft" | "active" | "archived";
  inventory: { mode: "unlimited" | "tracked"; available: number; reserved: number };
  auctionTemplate: { entryFee: number; regularPrice: number; durationMinutes: number; postAuctionOfferValidityDays: number };
  revision: number;
};

const EMPTY_FORM = {
  sku: "",
  name: "",
  description: "",
  imageUrlsText: "",
  category: "other" as Product["category"],
  status: "draft" as Product["status"],
  inventoryMode: "unlimited" as Product["inventory"]["mode"],
  available: 0,
  entryFee: 5,
  regularPrice: 100,
  durationMinutes: 10,
  validityDays: 7,
};

type Props = { onSessionExpired: () => void; onAuctionDraftCreated: () => void };

async function api<T>(path: string, init?: RequestInit) {
  const response = await fetch(path, { ...init, credentials: "same-origin", headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  const payload = await response.json().catch(() => ({})) as T & { outcome?: string };
  if (!response.ok) throw Object.assign(new Error(payload.outcome ?? "request_failed"), { status: response.status });
  return payload;
}

export function CatalogPanel({ onSessionExpired, onAuctionDraftCreated }: Props) {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editing, setEditing] = useState<Product | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setError("");
    setLoading(true);
    try {
      const collected: Product[] = [];
      const seen = new Set<string>();
      let cursor: string | null = null;
      for (let page = 0; page < 100; page += 1) {
        const suffix: string = cursor ? `&cursor=${encodeURIComponent(cursor)}` : "";
        const result: { products: Product[]; nextCursor: string | null } = await api<{ products: Product[]; nextCursor: string | null }>(`/api/admin/products?limit=50${suffix}`);
        for (const product of result.products) {
          if (!seen.has(product.productId)) {
            seen.add(product.productId);
            collected.push(product);
          }
        }
        cursor = result.nextCursor;
        if (!cursor) break;
        if (page === 99) throw new Error("catalog_page_limit");
      }
      setProducts(collected);
    } catch (caught) {
      if ((caught as { status?: number }).status === 401) onSessionExpired();
      else setError("Nie udało się pobrać katalogu produktów.");
    } finally {
      setLoading(false);
    }
  }, [onSessionExpired]);

  useEffect(() => { void load(); }, [load]);

  const edit = (product: Product) => {
    setEditing(product);
    setForm({
      sku: product.sku,
      name: product.name,
      description: product.description,
      imageUrlsText: product.imageUrls.join("\n"),
      category: product.category,
      status: product.status,
      inventoryMode: product.inventory.mode,
      available: product.inventory.available,
      entryFee: product.auctionTemplate.entryFee,
      regularPrice: product.auctionTemplate.regularPrice,
      durationMinutes: product.auctionTemplate.durationMinutes,
      validityDays: product.auctionTemplate.postAuctionOfferValidityDays,
    });
    setNotice("");
  };

  const save = async () => {
    setBusy(true);
    setError("");
    setNotice("");
    const product = {
      sku: form.sku,
      name: form.name,
      description: form.description,
      imageUrls: form.imageUrlsText.split(/\r?\n/).map((value) => value.trim()).filter(Boolean),
      category: form.category,
      status: form.status,
      inventory: { mode: form.inventoryMode, available: form.inventoryMode === "tracked" ? form.available : 0, reserved: editing?.inventory.reserved ?? 0 },
      auctionTemplate: { entryFee: form.entryFee, regularPrice: form.regularPrice, durationMinutes: form.durationMinutes, postAuctionOfferValidityDays: form.validityDays },
    };
    try {
      if (editing) {
        await api(`/api/admin/products/${encodeURIComponent(editing.productId)}`, { method: "PATCH", body: JSON.stringify({ expectedRevision: editing.revision, product }) });
        setNotice("Produkt został zaktualizowany.");
      } else {
        await api("/api/admin/products", { method: "POST", body: JSON.stringify(product) });
        setNotice("Produkt został dodany do katalogu.");
      }
      setEditing(null);
      setForm(EMPTY_FORM);
      await load();
    } catch (caught) {
      if ((caught as { status?: number }).status === 401) onSessionExpired();
      else setError("Nie udało się zapisać produktu. Sprawdź SKU, ceny i stan.");
    } finally { setBusy(false); }
  };

  const createDraft = async (product: Product) => {
    setBusy(true);
    setError("");
    try {
      await api(`/api/admin/products/${encodeURIComponent(product.productId)}/auction-draft`, { method: "POST", body: "{}" });
      setNotice(`Utworzono szkic aukcji dla „${product.name}”.`);
      onAuctionDraftCreated();
    } catch (caught) {
      if ((caught as { status?: number }).status === 401) onSessionExpired();
      else setError("Nie udało się utworzyć szkicu aukcji.");
    } finally { setBusy(false); }
  };

  return (
    <section className={styles.panelSection} aria-labelledby="catalog-heading" aria-busy={loading}>
      <div className={styles.sectionHeader}><div><p className={styles.eyebrow}>Produkty i szablony</p><h2 id="catalog-heading">Katalog produktów</h2></div><span className={styles.sectionCount}>{products.length}</span></div>
      {error ? <p className={styles.errorNotice} role="alert">{error}</p> : null}
      {notice ? <p className={styles.successNotice} role="status">{notice}</p> : null}
      <div className={styles.adminSubpanel}>
        <h3>{editing ? `Edytuj ${editing.name}` : "Dodaj produkt"}</h3>
        <div className={styles.operationsFormGrid}>
          <label className={styles.field}><span>SKU</span><input className={styles.input} value={form.sku} onChange={(event) => setForm((value) => ({ ...value, sku: event.target.value.toUpperCase() }))} /></label>
          <label className={styles.field}><span>Nazwa</span><input className={styles.input} value={form.name} onChange={(event) => setForm((value) => ({ ...value, name: event.target.value }))} /></label>
          <label className={styles.field}><span>Status</span><select className={styles.input} value={form.status} onChange={(event) => setForm((value) => ({ ...value, status: event.target.value as Product["status"] }))}><option value="draft">Szkic</option><option value="active">Aktywny</option><option value="archived">Archiwalny</option></select></label>
          <label className={styles.field}><span>Kategoria</span><select className={styles.input} value={form.category} onChange={(event) => setForm((value) => ({ ...value, category: event.target.value as Product["category"] }))}><option value="electronics">Elektronika</option><option value="home">Dom</option><option value="sport">Sport</option><option value="beauty">Uroda</option><option value="gaming">Gaming</option><option value="other">Pozostałe</option></select></label>
          <label className={styles.field}><span>Stan magazynowy</span><select className={styles.input} value={form.inventoryMode} onChange={(event) => setForm((value) => ({ ...value, inventoryMode: event.target.value as Product["inventory"]["mode"] }))}><option value="unlimited">Bez limitu</option><option value="tracked">Śledzony</option></select></label>
          {form.inventoryMode === "tracked" ? <label className={styles.field}><span>Dostępne sztuki</span><input className={styles.input} type="number" min="0" max="100000" value={form.available} onChange={(event) => setForm((value) => ({ ...value, available: Number(event.target.value) }))} /></label> : null}
          <label className={styles.field}><span>Wpisowe (zł)</span><input className={styles.input} type="number" min="1" value={form.entryFee} onChange={(event) => setForm((value) => ({ ...value, entryFee: Number(event.target.value) }))} /></label>
          <label className={styles.field}><span>Cena regularna (zł)</span><input className={styles.input} type="number" min="2" value={form.regularPrice} onChange={(event) => setForm((value) => ({ ...value, regularPrice: Number(event.target.value) }))} /></label>
          <label className={styles.field}><span>Czas aukcji (min)</span><input className={styles.input} type="number" min="1" max="120" value={form.durationMinutes} onChange={(event) => setForm((value) => ({ ...value, durationMinutes: Number(event.target.value) }))} /></label>
          <label className={styles.field}><span>Ważność rabatu (dni)</span><input className={styles.input} type="number" min="1" max="90" value={form.validityDays} onChange={(event) => setForm((value) => ({ ...value, validityDays: Number(event.target.value) }))} /></label>
        </div>
        <label className={styles.field}><span>Adresy zdjęć HTTPS (maks. 6, każdy w nowym wierszu)</span><textarea className={styles.input} rows={3} value={form.imageUrlsText} onChange={(event) => setForm((value) => ({ ...value, imageUrlsText: event.target.value }))} /></label>
        <label className={styles.field}><span>Opis wewnętrzny</span><textarea className={styles.input} rows={3} value={form.description} onChange={(event) => setForm((value) => ({ ...value, description: event.target.value }))} /></label>
        <div className={styles.cardActions}><button className={styles.cardPrimaryButton} type="button" disabled={busy} onClick={() => void save()}>{busy ? "Zapisuję…" : editing ? "Zapisz zmiany" : "Dodaj produkt"}</button>{editing ? <button className={styles.secondaryButton} type="button" onClick={() => { setEditing(null); setForm(EMPTY_FORM); }}>Anuluj</button> : null}</div>
      </div>
      <div className={styles.operationsList}>
        {products.map((product) => <article className={styles.adminSubpanel} key={product.productId}><div className={styles.sectionHeader}><div><h3>{product.name}</h3><p>{product.sku} · {product.status} · {product.auctionTemplate.regularPrice} zł · {product.inventory.mode === "tracked" ? `${product.inventory.available} szt.` : "bez limitu"}</p></div></div><div className={styles.cardActions}><button className={styles.secondaryButton} type="button" onClick={() => edit(product)}>Edytuj</button><button className={styles.cardPrimaryButton} type="button" disabled={busy || product.status === "archived"} onClick={() => void createDraft(product)}>Utwórz szkic aukcji</button></div></article>)}
        {!loading && !products.length ? <p className={styles.emptyState}>Katalog jest pusty. Dodaj pierwszy produkt powyżej.</p> : null}
      </div>
    </section>
  );
}
