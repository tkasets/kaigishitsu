import React from "react";
import { createRoot } from "react-dom/client";
import DeskLayoutPuzzle from "./desk-layout-puzzle.jsx";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <DeskLayoutPuzzle />
  </React.StrictMode>
);
