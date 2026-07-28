import { useId, useState } from "react";
import { CalendarIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  combineLocalDateTimeValue,
  splitLocalDateTimeValue,
} from "@/components/ui/date-time-value";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

// A calendar + time-input popover replacing the native `datetime-local`
// input (which browsers render inconsistently and can't be themed to match
// shadcn/Base UI) at the app's three kickoff/expiry/instant sites. Speaks the
// exact same "YYYY-MM-DDTHH:mm" local wall-clock string those sites already
// pass through `toLocalDateTimeInputValue`/`new Date(value).toISOString()`
// (sim-clock-card.tsx, sim-fixture-row.tsx via fixture-patch.ts,
// invite-panel.tsx) — a drop-in `value`/`onChange` replacement for the
// `Input type="datetime-local"` it replaces, so that round trip is untouched.
export function DateTimePicker({
  id,
  value,
  onChange,
  disabled,
  className,
  "aria-invalid": ariaInvalid,
  "aria-describedby": ariaDescribedby,
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
}) {
  const [open, setOpen] = useState(false);
  const timeInputId = useId();
  const { date, time } = splitLocalDateTimeValue(value);

  const handleDateSelect = (nextDate: Date | undefined) => {
    if (!nextDate) return;
    onChange(combineLocalDateTimeValue(nextDate, time));
  };

  const handleTimeChange = (nextTime: string) => {
    // A date has to exist before a time means anything, and the calendar is
    // the only control that can establish one — a time edit before that is a
    // no-op rather than silently anchoring to "today" (Clock rule: no
    // fabricated now() default for a real value, only for decorative
    // "today" highlighting, which the calendar does entirely on its own).
    if (!date) return;
    onChange(combineLocalDateTimeValue(date, nextTime));
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            id={id}
            type="button"
            variant="outline"
            disabled={disabled}
            aria-invalid={ariaInvalid}
            aria-describedby={ariaDescribedby}
            className={cn(
              "w-full min-w-0 justify-start gap-1.5 px-2.5 font-normal",
              !value && "text-muted-foreground",
              className,
            )}
          />
        }
      >
        <CalendarIcon className="size-4 shrink-0" />
        <span className="truncate">
          {value ? formatTriggerLabel(value) : "Pick a date and time"}
        </span>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-0">
        <Calendar mode="single" selected={date} onSelect={handleDateSelect} autoFocus />
        <div className="flex items-center justify-between gap-2 border-t border-border px-2.5 py-2">
          <Label htmlFor={timeInputId} className="text-xs text-muted-foreground">
            Time
          </Label>
          <Input
            id={timeInputId}
            type="time"
            value={time}
            disabled={!date}
            title={date ? undefined : "Pick a date first"}
            onChange={(event) => handleTimeChange(event.target.value)}
            className="w-auto"
          />
        </div>
        {value && (
          <div className="border-t border-border p-1.5">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-full"
              onClick={() => {
                onChange("");
                setOpen(false);
              }}
            >
              Clear
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

// The trigger's accessible name/visible label — locale-aware like the rest of
// lib/format.ts's formatters, kept local rather than reusing `formatDateTime`
// there since that helper is typed for an ISO instant and this value is a
// naive local wall-clock string (same shape, different contract).
function formatTriggerLabel(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}
