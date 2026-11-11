export const LEGACY_ENTRY_SERVICE_CONSENT_VERSION = "entry-service-v2-2026-10-17";
export const ENTRY_SERVICE_CONSENT_VERSION = "entry-service-v3-2026-11-11";
export const ENTRY_SERVICE_CONSENT_TEXT = "Żądam rozpoczęcia usługi dostępu do aukcji przed upływem 14 dni od zawarcia umowy. Przyjmuję do wiadomości, że po pełnym wykonaniu usługi utracę prawo odstąpienia od tej umowy.";
const legacyText = "Żądam rozpoczęcia świadczenia usługi dostępu do tej aukcji przed upływem 14 dni od zawarcia umowy. Przyjmuję do wiadomości, że po pełnym wykonaniu usługi, czyli udostępnieniu udziału i zakończeniu tej aukcji, utracę prawo odstąpienia od umowy o tę usługę. Nie ogranicza to prawa odstąpienia od zakupu produktu ani prawa do reklamacji.";

export function entryServiceTerms(version: unknown) {
  if (version === undefined || version === LEGACY_ENTRY_SERVICE_CONSENT_VERSION) return { version: LEGACY_ENTRY_SERVICE_CONSENT_VERSION, text: legacyText };
  if (version === ENTRY_SERVICE_CONSENT_VERSION) return { version: ENTRY_SERVICE_CONSENT_VERSION, text: ENTRY_SERVICE_CONSENT_TEXT };
  return null;
}
