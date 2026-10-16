export function sellerDetails() {
  return {
    name: process.env.FISZY_SELLER_NAME?.trim() || "Jakub Ryba",
    address: process.env.FISZY_SELLER_ADDRESS?.trim() || "ul. Łężyca-Chabrowa 4/2, 66-016 Zielona Góra",
    returnAddress: process.env.FISZY_RETURN_ADDRESS?.trim() || process.env.FISZY_SELLER_ADDRESS?.trim() || "ul. Łężyca-Chabrowa 4/2, 66-016 Zielona Góra",
    email: process.env.FISZY_CONTACT_EMAIL?.trim() || "kontakt@fiszy.pl",
    phone: process.env.FISZY_CONTACT_PHONE?.trim() || "+48 534 121 777",
    nip: process.env.FISZY_SELLER_NIP?.trim() || "",
  };
}
export function sellerIdentification() {
  const seller = sellerDetails();
  return [seller.name, seller.address, seller.nip ? `NIP: ${seller.nip}` : "Działalność nierejestrowana; sprzedawca nie posiada NIP", `Kontakt: ${seller.email}`, seller.phone ? `Telefon: ${seller.phone}` : ""].filter(Boolean).join(". ");
}
export function sellerReady() {
  const seller = sellerDetails();
  return Boolean(seller.address && seller.phone && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(seller.email));
}
