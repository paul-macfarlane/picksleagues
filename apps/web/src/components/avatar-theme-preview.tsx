import { initialsOf } from "@/lib/user";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

const SWATCHES = [
  { theme: "light", label: "Light" },
  { theme: "dark", label: "Dark" },
] as const;

/**
 * The candidate avatar on a light and a dark ground at once. A transparent
 * image can read fine in whichever theme the member happens to be in and
 * vanish in the other, and the only other way to catch that is to save and
 * flip the app theme (ID-5). Each swatch scopes the real palette (`.light` /
 * `.dark` redeclare the tokens in index.css) rather than painting literal
 * white and black, so what it shows is what the other theme actually renders.
 */
export function AvatarThemePreview({
  image,
  displayName,
}: {
  image: string | null;
  displayName: string;
}) {
  return (
    <div className="grid grid-cols-2 gap-2" role="group" aria-label="Avatar preview by theme">
      {SWATCHES.map(({ theme, label }) => (
        <div
          key={theme}
          className={`${theme} flex flex-col items-center gap-1.5 rounded-md border border-border bg-background p-3`}
        >
          <Avatar size="lg">
            <AvatarImage src={image ?? undefined} alt="" />
            <AvatarFallback>{initialsOf(displayName)}</AvatarFallback>
          </Avatar>
          <span className="text-xs text-muted-foreground">{label}</span>
        </div>
      ))}
    </div>
  );
}
