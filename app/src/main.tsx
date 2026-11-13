import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";
import { ehJanelaDaBusca } from "./backend";
import { JanelaDaBusca } from "./ui/Busca";
import "./estilo.css";

// A mesma página serve as duas janelas: o balão e a janelinha dos botões de busca da loja.
createRoot(document.getElementById("raiz")!).render(
  <StrictMode>{ehJanelaDaBusca() ? <JanelaDaBusca /> : <App />}</StrictMode>,
);
