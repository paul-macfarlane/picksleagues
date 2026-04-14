import { cn } from "@/lib/utils";

export function LogoMark({
  className,
  title,
}: {
  className?: string;
  title?: string;
}) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 64 64"
      className={cn("h-7 w-7", className)}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      {title ? <title>{title}</title> : null}
      <rect
        x="2"
        y="2"
        width="60"
        height="60"
        rx="14"
        className="fill-primary"
      />
      <path
        d="M22 17h13.5c6.35 0 10.5 3.95 10.5 10.1 0 6.15-4.15 10.1-10.5 10.1H29v9.8h-7V17Zm13 14.1c2.85 0 4.6-1.45 4.6-4 0-2.6-1.75-4.05-4.6-4.05H29v8.05h6Z"
        className="fill-primary-foreground"
      />
    </svg>
  );
}
