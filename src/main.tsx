import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { LibraryProvider } from "./hooks/useLibrary";
import App from "./App";
import "./styles.css";
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
if (import.meta.env.PROD && "serviceWorker" in navigator)
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js")
      .catch((error) => console.warn("Offline support unavailable", error));
  });
