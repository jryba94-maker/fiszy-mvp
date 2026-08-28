export type OperationsPriority = "critical" | "warning" | "ready";

export type OperationsStatusInput = {
  messages: Array<{ state: string; attempts: number }>;
  cases: Array<{ status: string; responseDueAt: string }>;
  privacy: Array<{ status: string; dueAt: string }>;
  now?: number;
};

export type OperationsStatus = {
  priority: OperationsPriority;
  requiresAction: number;
  deadMessages: number;
  retryingMessages: number;
  overdueCases: number;
  overduePrivacyRequests: number;
  openCases: number;
  openPrivacyRequests: number;
};

const TERMINAL_CASE_STATUSES = new Set(["completed", "rejected"]);
const TERMINAL_PRIVACY_STATUSES = new Set(["completed", "rejected"]);

function isOverdue(value: string, now: number) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && timestamp < now;
}

export function evaluateOperationsStatus(input: OperationsStatusInput): OperationsStatus {
  const now = input.now ?? Date.now();
  const deadMessages = input.messages.filter((message) => message.state === "dead").length;
  const retryingMessages = input.messages.filter((message) => message.state === "retry").length;
  const openCases = input.cases.filter((item) => !TERMINAL_CASE_STATUSES.has(item.status)).length;
  const overdueCases = input.cases.filter(
    (item) => !TERMINAL_CASE_STATUSES.has(item.status) && isOverdue(item.responseDueAt, now),
  ).length;
  const openPrivacyRequests = input.privacy.filter(
    (item) => !TERMINAL_PRIVACY_STATUSES.has(item.status),
  ).length;
  const overduePrivacyRequests = input.privacy.filter(
    (item) => !TERMINAL_PRIVACY_STATUSES.has(item.status) && isOverdue(item.dueAt, now),
  ).length;
  const requiresAction = deadMessages + overdueCases + overduePrivacyRequests;

  return {
    priority: requiresAction > 0 ? "critical" : retryingMessages > 0 ? "warning" : "ready",
    requiresAction,
    deadMessages,
    retryingMessages,
    overdueCases,
    overduePrivacyRequests,
    openCases,
    openPrivacyRequests,
  };
}
