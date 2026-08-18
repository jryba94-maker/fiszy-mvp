export type BrowserReminderSettings = {
  enabled: boolean;
  leadMinutes: 5 | 10 | 15 | 30;
};

const SETTINGS_KEY = "fiszy:pwa:reminders:v1";
const SEEN_KEY = "fiszy:pwa:reminders:seen:v1";

export const REMINDER_SETTINGS_EVENT = "fiszy:reminder-settings-changed";
export const WATCHLIST_CHANGED_EVENT = "fiszy:watchlist-changed";

const defaultSettings: BrowserReminderSettings = {
  enabled: false,
  leadMinutes: 10,
};

export function readBrowserReminderSettings(): BrowserReminderSettings {
  if (typeof window === "undefined") return defaultSettings;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(SETTINGS_KEY) ?? "null") as Partial<BrowserReminderSettings> | null;
    const leadMinutes = parsed?.leadMinutes;
    return {
      enabled: parsed?.enabled === true,
      leadMinutes: leadMinutes === 5 || leadMinutes === 10 || leadMinutes === 15 || leadMinutes === 30
        ? leadMinutes
        : defaultSettings.leadMinutes,
    };
  } catch {
    return defaultSettings;
  }
}

export function saveBrowserReminderSettings(settings: BrowserReminderSettings) {
  window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  window.dispatchEvent(new CustomEvent(REMINDER_SETTINGS_EVENT));
}

export function readSeenReminderIds() {
  if (typeof window === "undefined") return new Set<string>();
  try {
    const parsed = JSON.parse(window.localStorage.getItem(SEEN_KEY) ?? "[]") as unknown;
    if (!Array.isArray(parsed)) return new Set<string>();
    return new Set(parsed.filter((item): item is string => typeof item === "string").slice(-100));
  } catch {
    return new Set<string>();
  }
}

export function rememberReminderId(id: string) {
  const ids = [...readSeenReminderIds(), id];
  window.localStorage.setItem(SEEN_KEY, JSON.stringify([...new Set(ids)].slice(-100)));
}

export function announceWatchlistChange() {
  window.dispatchEvent(new CustomEvent(WATCHLIST_CHANGED_EVENT));
}
