import { createContext, useContext, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AppTabBar } from "@/components/app-tab-bar";

const BottomBarTarget = createContext<HTMLDivElement | null>(null);

/**
 * Signed-in bottom chrome shares one viewport anchor. Independent fixed bars
 * can separate while Chrome on iOS moves its browser toolbar; ordinary flow
 * keeps the pick actions touching the navigation throughout that movement.
 */
export function AppBottomBar({ children }: { children?: ReactNode }) {
  const [target, setTarget] = useState<HTMLDivElement | null>(null);

  return (
    <BottomBarTarget.Provider value={target}>
      {children}
      <div className="fixed inset-x-0 bottom-0 z-20 bg-background">
        <div ref={setTarget} />
        <AppTabBar />
      </div>
    </BottomBarTarget.Provider>
  );
}

/** Render route-owned controls above navigation inside the shell's fixed bar. */
export function AppBottomBarActions({ children }: { children: ReactNode }) {
  const target = useContext(BottomBarTarget);
  return target ? createPortal(children, target) : null;
}
