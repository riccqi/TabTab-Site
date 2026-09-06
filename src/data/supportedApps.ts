import safariLogo from "../../public/safari-logo.png";
import chromeLogo from "../../public/chrome-logo.png";
import braveLogo from "../../public/brave-logo.png";
import edgeLogo from "../../public/edge-logo.png";
import firefoxLogo from "../../public/firefox-logo.png";
import arcLogo from "../../public/arc-logo.png";
import vscodeLogo from "../../public/vscode-logo.png";
import xcodeLogo from "../../public/xcode-logo.png";
import cursorLogo from "../../public/cursor-logo.png";
import cometLogo from "../../public/comet-logo.png";
import heliumLogo from "../../public/helium-logo.png";
import figmaLogo from "../../public/figma-logo.png";
import previewLogo from "../../public/preview-logo.png";
import finderLogo from "../../public/finder-logo.png";
import terminalLogo from "../../public/terminal-logo.png";
import notionLogo from "../../public/notion-logo.png";
import forkLogo from "../../public/fork-logo.png";
import diaLogo from "../../public/dia-logo.png";

interface SupportedApp {
  name: string;
  category: "browsers" | "editors" | "design" | "utilities";
  logo: typeof safariLogo;
  variants?: string[];
  logoPadding?: string;
}

// Shared by the homepage grid, FAQ, and search guide.
export const supportedApps: SupportedApp[] = [
  { name: "Safari", category: "browsers", logo: safariLogo },
  { name: "Google Chrome", category: "browsers", logo: chromeLogo, variants: ["Google Chrome Beta"] },
  { name: "Brave", category: "browsers", logo: braveLogo },
  { name: "Microsoft Edge", category: "browsers", logo: edgeLogo },
  { name: "Firefox", category: "browsers", logo: firefoxLogo, variants: ["Firefox Nightly", "Firefox Developer Edition"] },
  { name: "Arc", category: "browsers", logo: arcLogo },
  { name: "Dia", category: "browsers", logo: diaLogo },
  { name: "Visual Studio Code", category: "editors", logo: vscodeLogo, logoPadding: "p-2" },
  { name: "Xcode", category: "editors", logo: xcodeLogo },
  { name: "Cursor", category: "editors", logo: cursorLogo, logoPadding: "p-1" },
  { name: "Comet", category: "browsers", logo: cometLogo },
  { name: "Helium", category: "browsers", logo: heliumLogo, logoPadding: "p-1" },
  { name: "Figma", category: "design", logo: figmaLogo },
  { name: "Preview", category: "utilities", logo: previewLogo },
  { name: "Finder", category: "utilities", logo: finderLogo },
  { name: "Terminal", category: "utilities", logo: terminalLogo },
  { name: "Notion", category: "utilities", logo: notionLogo },
  { name: "Fork", category: "utilities", logo: forkLogo },
];

export const supportedAppGroups = [
  { category: "browsers", label: "Browsers" },
  { category: "editors", label: "Code editors" },
  { category: "design", label: "Design" },
  { category: "utilities", label: "Utilities" },
].map(({ category, label }) => ({
  label,
  names: supportedApps
    .filter((app) => app.category === category)
    .flatMap((app) => [app.name, ...(app.variants ?? [])]),
}));
