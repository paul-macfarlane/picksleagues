"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export interface SeasonOption {
  id: string;
  year: number;
}

export function SeasonSwitcher({
  options,
  selectedSeasonId,
}: {
  options: SeasonOption[];
  selectedSeasonId: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function handleChange(value: string): void {
    const params = new URLSearchParams(searchParams);
    params.set("season", value);
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <Select value={selectedSeasonId} onValueChange={handleChange}>
      <SelectTrigger className="w-32">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.id} value={option.id}>
            {option.year}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
