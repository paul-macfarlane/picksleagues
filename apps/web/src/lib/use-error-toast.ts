import { useEffect } from "react";
import { toast } from "sonner";

// Every query-backed screen was hand-rolling the same `useEffect(() => {
// if (isError) toast.error(...) }, [isError])` — one hook instead, so the
// error-toast side effect has a single home alongside `QueryState` (the
// loading/error/empty render triad it's meant to pair with).
export function useErrorToast(isError: boolean, message: string) {
  useEffect(() => {
    if (isError) {
      toast.error(message);
    }
  }, [isError, message]);
}
