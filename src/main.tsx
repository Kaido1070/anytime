import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { LibraryProvider } from "./hooks/useLibrary";
import App from "./App";
import "./styles.css";
import "./mobile-fixes.css";

const root =
  import.meta.hot?.data.root ?? createRoot(document.getElementById("root")!);
if (import.meta.hot) import.meta.hot.data.root = root;

root.render(
  <BrowserRouter>
    <LibraryProvider>
      <App />
    </LibraryProvider>
  </BrowserRouter>,
);

if (import.meta.env.PROD && "serviceWorker" in navigator) {
  const hadController = Boolean(navigator.serviceWorker.controller);
  let refreshing = false;

  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!hadController || refreshing) return;
    refreshing = true;
    window.location.reload();
  });

  window.addEventListener("load", async () => {
    try {
      const registration = await navigator.serviceWorker.register("/sw.js", {
        updateViaCache: "none",
      });
      await registration.update();
    } catch (error) {
      console.warn("Offline support unavailable", error);
    }
  });
}
