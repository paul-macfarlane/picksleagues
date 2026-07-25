import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// Generic labeled select over `{ value, label }[]` — shared by the league
// settings fieldsets' week/push-tie pickers and the admin games browser's
// season/week pickers, so a labeled Select is written once.
// Generic over the option's literal union (same idiom as RadioField) so a
// caller whose values are a const-object union keeps that type through the
// callback instead of casting a bare string back to it.
export function LabeledSelect<Value extends string>({
  id,
  label,
  value,
  onValueChange,
  options,
}: {
  id: string;
  label: string;
  // `null`, never `undefined` — Base UI's Select treats a value transitioning
  // to `undefined` as switching from controlled to uncontrolled (console
  // warning); `null` is its documented "no selection" value.
  value: Value | null;
  onValueChange: (value: Value) => void;
  options: { value: Value; label: string }[];
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {/* `items` is Base UI's value→label map for the closed trigger — without
          it, Select.Value renders the raw wire value ("regular:1") instead of
          the option label ("Week 1"). Since options are already `{value, label}`,
          Base UI reads the label straight off them, no `itemToStringLabel` needed. */}
      <Select
        items={options}
        value={value}
        onValueChange={(next) => {
          if (next) onValueChange(next as Value);
        }}
      >
        <SelectTrigger id={id} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
