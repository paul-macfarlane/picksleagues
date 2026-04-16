"use client";

import { useTransition } from "react";
import { toast } from "sonner";

import { advancePhaseAction } from "@/actions/simulator";
import { Button } from "@/components/ui/button";

export function AdvancePhaseButton({
  disabled,
  currentPhaseLabel,
}: {
  disabled: boolean;
  currentPhaseLabel: string | null;
}) {
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    startTransition(async () => {
      const result = await advancePhaseAction();
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success(
        currentPhaseLabel
          ? `Advanced past ${currentPhaseLabel}`
          : "Advanced phase",
      );
    });
  }

  return (
    <Button
      onClick={handleClick}
      disabled={disabled || isPending}
      className="w-fit"
    >
      {isPending ? "Advancing…" : "Advance phase"}
    </Button>
  );
}
