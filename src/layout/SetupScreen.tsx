import { open } from "@tauri-apps/plugin-dialog";
import { useState } from "react";
import { updateSettings } from "../lib/settings";
import { vaultInit } from "../lib/vault";

interface SetupScreenProps {
  root: string;
  containerExists: boolean;
  onReady(): void;
  onCheckAgain(): void;
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function SetupScreen({ root, containerExists, onReady, onCheckAgain }: SetupScreenProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (step: () => Promise<boolean>) => {
    setBusy(true);
    setError(null);
    try {
      if (await step()) onReady();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };

  const useDefault = () =>
    run(async () => {
      await vaultInit();
      return true;
    });

  const chooseFolder = () =>
    run(async () => {
      const chosen = await open({ directory: true, multiple: false, title: "Choose your Tack vault folder" });
      if (chosen === null) return false;
      await updateSettings((settings) => ({ ...settings, vaultRoot: chosen }));
      await vaultInit();
      return true;
    });

  return (
    <main className="tack-setup">
      <h1>Set up Tack</h1>
      <p>Tack keeps your notes in an Obsidian vault in iCloud, so they are on your iPhone too.</p>
      <ol>
        <li>Install Obsidian on your iPhone.</li>
        <li>In Obsidian, create a vault named “Tack” and store it in iCloud.</li>
        <li>Wait until the “Tack” folder appears on this Mac.</li>
        <li>
          In Obsidian, open Settings → Files and links and set “Default location for new notes” to the Inbox folder.
        </li>
      </ol>
      <p className="tack-setup-root">
        Tack looks for it here: <code>{root}</code>
      </p>
      <div className="tack-setup-buttons">
        <button
          type="button"
          className="tack-primary"
          disabled={busy || !containerExists}
          onClick={() => void useDefault()}
        >
          Use this folder
        </button>
        <button type="button" disabled={busy} onClick={() => void chooseFolder()}>
          Choose another folder
        </button>
      </div>
      {!containerExists && (
        <p className="tack-setup-wait">
          Obsidian's iCloud folder is not on this Mac yet. Finish the steps above, then check again.{" "}
          <button type="button" onClick={onCheckAgain}>
            Check again
          </button>
        </p>
      )}
      {error && (
        <p className="tack-error" role="alert">
          {error}
        </p>
      )}
    </main>
  );
}
