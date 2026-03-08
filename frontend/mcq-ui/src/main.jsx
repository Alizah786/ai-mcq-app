import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/tokens.css";
import "./index.css";
import App from "./App.jsx";
import { AuthProvider } from "./context/AuthContext.jsx";
import { UITextProvider } from "./context/UITextContext.jsx";
import { LocaleProvider } from "./context/LocaleContext.jsx";
import "./i18n";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <AuthProvider>
      <LocaleProvider>
        <UITextProvider>
          <App />
        </UITextProvider>
      </LocaleProvider>
    </AuthProvider>
  </StrictMode>
);
