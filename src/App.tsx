import { getCurrentWindow } from "@tauri-apps/api/window";
import { useCallback, useEffect, useState } from "react";
import { MainWindow } from "./layout/MainWindow";
import { SetupScreen } from "./layout/SetupScreen";
import { vaultStatus } from "./lib/vault";
import { onQuitRequested } from "./lib/window";
import "./styles/tokens.css";
import "./styles/app.css";

type Phase =
  | { kind: "checking" }
  | { kind: "setup"; root: string; containerExists: boolean }
  | { kind: "ready" }
  | { kind: "failed"; error: string };

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

function App() {
  const [phase, setPhase] = useState<Phase>({ kind: "checking" });

  const check = useCallback(() => {
    vaultStatus().then(
      (status) =>
        setPhase(
          status.exists
            ? { kind: "ready" }
            : { kind: "setup", root: status.root, containerExists: status.containerExists },
        ),
      (e: unknown) => setPhase({ kind: "failed", error: message(e) }),
    );
  }, []);

  useEffect(check, [check]);

  const mainWindowShown = phase.kind === "ready";
  useEffect(() => {
    if (mainWindowShown) return;
    let stopped = false;
    let unlisten: (() => void) | undefined;
    void onQuitRequested(() => void getCurrentWindow().destroy()).then((stop) =>
      stopped ? stop() : (unlisten = stop),
    );
    return () => {
      stopped = true;
      unlisten?.();
    };
  }, [mainWindowShown]);

  switch (phase.kind) {
    case "checking":
      return null;
    case "setup":
      return (
        <SetupScreen
          root={phase.root}
          containerExists={phase.containerExists}
          onReady={() => setPhase({ kind: "ready" })}
          onCheckAgain={check}
        />
      );
    case "failed":
      return (
        <main className="tack-setup">
          <p className="tack-error" role="alert">
            Tack could not open the vault: {phase.error}
          </p>
        </main>
      );
    case "ready":
      return <MainWindow />;
  }
}

export default App;
