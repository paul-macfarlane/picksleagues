import { XIcon } from "lucide-react";
import { INSTALL_PATH, useInstallPrompt } from "@/lib/install-prompt";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

/**
 * The one place the app says it installs (LNCH-16). Lives on the profile page
 * rather than as a banner: a banner on the dashboard competes with picks, and
 * a member who wants the app on their home screen goes looking in settings.
 * Renders nothing once installed, dismissed, or on a browser with no path.
 */
export function InstallCard() {
  const { path, install, dismiss } = useInstallPrompt();
  if (path === INSTALL_PATH.none) return null;

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>Add to your home screen</CardTitle>
        <CardDescription>
          Picks Leagues installs like an app — it opens full-screen, without the browser bar.
        </CardDescription>
        <CardAction>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Dismiss install suggestion"
            onClick={dismiss}
          >
            <XIcon />
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        {path === INSTALL_PATH.native ? (
          <Button
            type="button"
            size="lg"
            className="w-full justify-center"
            onClick={() => void install()}
          >
            Install app
          </Button>
        ) : path === INSTALL_PATH.ios ? (
          <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
            <li>
              Tap <span className="font-medium text-foreground">Share</span> in Safari&apos;s
              toolbar.
            </li>
            <li>
              Choose <span className="font-medium text-foreground">Add to Home Screen</span>, then{" "}
              <span className="font-medium text-foreground">Add</span>.
            </li>
          </ol>
        ) : (
          // One wording for every Android browser (MOB-8, owner 2026-08-23):
          // the menu item is "Add to Home screen" on Chrome and Samsung
          // Internet and "Install" on Firefox — naming both beats sniffing
          // three browsers to save four words.
          <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
            <li>
              Open your browser&apos;s menu (<span className="font-medium text-foreground">⋮</span>
              ).
            </li>
            <li>
              Choose <span className="font-medium text-foreground">Add to Home screen</span> (or{" "}
              <span className="font-medium text-foreground">Install</span>), then confirm.
            </li>
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
