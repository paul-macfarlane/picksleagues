import * as React from "react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { XIcon } from "lucide-react";

import { cn } from "@/lib/utils";

function Sheet({ ...props }: DialogPrimitive.Root.Props) {
  return <DialogPrimitive.Root data-slot="sheet" {...props} />;
}

function SheetTrigger({ ...props }: DialogPrimitive.Trigger.Props) {
  return <DialogPrimitive.Trigger data-slot="sheet-trigger" {...props} />;
}

function SheetPortal({ ...props }: DialogPrimitive.Portal.Props) {
  return <DialogPrimitive.Portal data-slot="sheet-portal" {...props} />;
}

function SheetOverlay({ className, ...props }: DialogPrimitive.Backdrop.Props) {
  return (
    <DialogPrimitive.Backdrop
      data-slot="sheet-overlay"
      className={cn(
        "fixed inset-0 isolate z-50 bg-black/10 duration-100 supports-backdrop-filter:backdrop-blur-xs data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
        className,
      )}
      {...props}
    />
  );
}

// Two edges are wired up: the left drawer (mobile nav) and the bottom sheet
// (matchup stats). `bottom` caps its height and on wider screens narrows to a
// centered panel rather than a full-width slab. It deliberately does NOT
// scroll itself: the popup is where the absolutely-positioned close button
// lives, and a scrolling popup carries that button — the only named dismiss
// control — off-screen with the content. The call site owns an inner
// `overflow-y-auto` region instead, so the close (and any header) stay put.
const SHEET_SIDE_CLASS_NAME = {
  left: "inset-y-0 left-0 h-full w-3/4 max-w-xs data-open:slide-in-from-left data-closed:slide-out-to-left",
  bottom:
    "inset-x-0 bottom-0 mx-auto max-h-[85dvh] w-full rounded-t-xl sm:max-w-lg data-open:slide-in-from-bottom data-closed:slide-out-to-bottom",
} as const;

function SheetContent({
  className,
  children,
  side = "left",
  closeLabel = "Close navigation",
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Popup> & {
  side?: keyof typeof SHEET_SIDE_CLASS_NAME;
  closeLabel?: string;
}) {
  return (
    <SheetPortal>
      <SheetOverlay />
      <DialogPrimitive.Popup
        data-slot="sheet-content"
        className={cn(
          "fixed z-50 flex flex-col gap-4 bg-popover p-4 text-popover-foreground shadow-lg ring-1 ring-foreground/10 duration-200 outline-none data-open:animate-in data-closed:animate-out",
          SHEET_SIDE_CLASS_NAME[side],
          className,
        )}
        {...props}
      >
        {children}
        <SheetClose
          aria-label={closeLabel}
          className="absolute top-3 right-3 rounded-md p-1 text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <XIcon className="size-4" />
        </SheetClose>
      </DialogPrimitive.Popup>
    </SheetPortal>
  );
}

function SheetHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div data-slot="sheet-header" className={cn("flex flex-col gap-1.5", className)} {...props} />
  );
}

function SheetTitle({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="sheet-title"
      className={cn("font-heading text-base font-medium text-foreground", className)}
      {...props}
    />
  );
}

function SheetClose({ ...props }: DialogPrimitive.Close.Props) {
  return <DialogPrimitive.Close data-slot="sheet-close" {...props} />;
}

export {
  Sheet,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetOverlay,
  SheetPortal,
  SheetTitle,
  SheetTrigger,
};
