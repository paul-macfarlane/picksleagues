import { toast } from "sonner";

/**
 * Success confirmations are glanceable acknowledgements — the member already
 * knows what they did — so they clear well before sonner's 4s default, which
 * had them lingering over whatever the member moved on to (FB-21). Errors stay
 * on plain `toast.error` at the default: they carry instructions ("review the
 * lines and submit again") the member has to read and act on. New success
 * toasts go through this, not `toast.success`, or the duration quietly forks.
 */
const SUCCESS_DURATION_MS = 2500;

export function toastSuccess(message: string): void {
  toast.success(message, { duration: SUCCESS_DURATION_MS });
}
