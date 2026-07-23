import { toast } from "sonner";
import type { ErrorResponse } from "@picksleagues/schemas";

// The `{data, error, response} → if (error) {map status→toast; return null}
// throw error` skeleton restated across most mutations: an expected server
// refusal (a catalogued 4xx) toasts and stops; anything else is a bug and
// rethrows so react-query's onError path (the logged 500 case) still fires.
// `toastMessage` lets a call site swap in custom copy or branch on the wire
// error slug (e.g. ERROR_CODE.MAX_MEMBERS_BELOW_MEMBER_COUNT) — it defaults to
// the server's own message. Form-error sites (409 username-taken) don't use
// this at all; they map straight to a field error, never a toast.
export function toastOnExpectedError(
  error: ErrorResponse,
  response: Response,
  isExpected: (status: number, error: ErrorResponse) => boolean,
  toastMessage: (error: ErrorResponse) => string = (err) => err.message,
): void {
  if (!isExpected(response.status, error)) throw error;
  toast.error(toastMessage(error));
}
