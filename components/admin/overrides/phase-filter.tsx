"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function PhaseFilter({
  phases,
  current,
}: {
  phases: Array<{ id: string; label: string }>;
  current: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  function onChange(nextPhaseId: string) {
    const next = new URLSearchParams(params.toString());
    next.set("phase", nextPhaseId);
    router.push(`${pathname}?${next.toString()}`);
  }

  return (
    <Select value={current} onValueChange={onChange}>
      <SelectTrigger className="w-full sm:w-56">
        <SelectValue placeholder="Select phase" />
      </SelectTrigger>
      <SelectContent>
        {phases.map((p) => (
          <SelectItem key={p.id} value={p.id}>
            {p.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
