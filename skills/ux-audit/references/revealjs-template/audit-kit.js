/**
 * @rolemodel/audit-kit — first pass
 *
 * Vanilla web components for audit deliverables. Works in reveal.js (deck)
 * and stand-alone HTML (paged-document). No build step. Drop this <script>
 * onto any page and the custom elements register automatically.
 *
 * Theming surface (CSS custom properties — set on :root or on <audit-deck>).
 * Defaults align with baseTokens / theme.css (--color-*).
 * Semantic aliases on each component :host: --text, --text-muted, --text-light,
 * --accent, --dark, --section-number; on dark slides --audit-number-emphasis (see baseTokens).
 * Override colors per element with inline CSS variables on the host, e.g.
 * style="--accent: var(--audit-accent); --text: var(--color-text)".
 * audit-strength: title-color / body-color (optional legacy color applies both).
 * Attribute values: var(--foo), --foo, or foo → var(--foo); plus hex/rgb/hsl.
 *
 * Slide surface theme (Reveal-friendly): put `data-background-color="#hex"` on the
 * enclosing `<section>`. Kit sets `data-audit-surface="dark"|"light"` from luminance
 * and lifts typography/borders via :host-context — omit `audit-slide variant` for auto.
 * Slide headings on dark slides: optional `--audit-slide-heading-user` on `:root` or
 * `<audit-slide>` (defaults to `--color-accent-green`). Resolved after connect so
 * inherited `color` from Reveal (e.g. section `color: white`) cannot mask a broken var().
 * Large row numerals on dark slides (`audit-finding`, `audit-stat`, `audit-rec-item`):
 * `--audit-number-emphasis` → `--audit-number-user` on `:root` or host (same default green).
 *
 * Slide chrome: `--audit-slide-padding` on `:root` (default `56px 80px`) controls inset
 * of `<audit-slide>`, `<audit-finding>`, and `<audit-cover>` content from the section edge.
 *
 * Components defined:
 *   <audit-cover>       hero/cover slide; centers content vertically by default,
 *                       pins to bottom when a `background` image is provided;
 *                       add the `nav` attribute to render the "Begin" affordance
 *   <audit-stat>        single stat row (n× inside exec summary)
 *   <audit-browser>     browser chrome mockup; attrs `url` (address bar), `image` (static fallback);
 *                       embed live page: set `src` or `source` (iframe URL), or `live`/`iframe` + `url`;
 *                       optional `sandbox` (defaults to SPA-friendly flags), `preload` → loading=eager;
 *                       slot `image` replaces static screenshot when not embedding
 *   <audit-strength>    one card in the Then grid
 *   <audit-finding>     numbered finding section
 *   <audit-palette-row> one row of palette swatches
 *   <audit-principle>   single UX principle row
 *   <audit-rec-item>    single recommendation row
 *   <audit-footer>      brand footer for closing slide
 *   <audit-slide>       padded slide wrapper (auto theme from section bg)
 *
 * Each component is a thin shadow-DOM custom element. Inner content goes
 * through named slots. Reveal.js still owns the outer `<section>`.
 */

const sharedFont = `
  :host { font-family: var(--audit-font-family, 'DM Sans', -apple-system, sans-serif); }
  /* !important: document-level .reveal rules beat ::slotted() in cascade tie-breaks */
  ::slotted(*) {
    font-family: var(--audit-font-family, 'DM Sans', -apple-system, sans-serif) !important;
  }
`;

/**
 * Resolve a color-related HTML attribute to a CSS <color> value.
 * Pass-through: var(...), #hex, rgb/hsl, color-mix, CSS keywords.
 * Variables: "--audit-accent" → var(--audit-accent); "color-primary" → var(--color-primary).
 */
const cssColorFromAttr = (value) => {
  const v = (value || "").trim();
  if (!v) return "";
  const kw = v.toLowerCase();
  if (
    kw === "currentcolor" ||
    kw === "inherit" ||
    kw === "transparent" ||
    kw === "initial" ||
    kw === "unset"
  ) {
    return v;
  }
  if (
    /^var\s*\(/i.test(v) ||
    /^#[\da-f]{3,8}$/i.test(v) ||
    /^rgb/i.test(v) ||
    /^hsl/i.test(v) ||
    /^color-mix/i.test(v)
  ) {
    return v;
  }
  if (/^--[\w-]+$/.test(v)) {
    return `var(${v})`;
  }
  if (/^[\w-]+$/.test(v)) {
    return `var(--${v})`;
  }
  return "";
};

/** WCAG relative luminance threshold — below this, `data-background-color` drives dark surface tokens. */
const AUDIT_BG_LUMA_THRESHOLD = 0.45;

const parseColorToRgb = (raw) => {
  if (!raw || typeof raw !== "string") return null;
  const s = raw.trim();
  const hex = s.match(/^#([\da-f]{3}|[\da-f]{6})$/i);
  if (hex) {
    let h = hex[1];
    if (h.length === 3) h = [...h].map((c) => c + c).join("");
    const n = parseInt(h, 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }
  const rgb = s.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i);
  if (rgb) return { r: +rgb[1], g: +rgb[2], b: +rgb[3] };
  return null;
};

const relativeLuminanceRgb = (rgb) => {
  if (!rgb) return 1;
  const lin = [rgb.r, rgb.g, rgb.b].map((c) => {
    c /= 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
};

const isDarkBackgroundColorAttr = (raw) =>
  relativeLuminanceRgb(parseColorToRgb(raw || "")) < AUDIT_BG_LUMA_THRESHOLD;

const resolveAuditSurface = (el) => {
  const section = el.closest("section");
  const slide = el.closest("audit-slide");
  const variant = slide?.getAttribute("variant");
  if (variant === "dark") return "dark";
  if (variant === "light") return "light";
  if (
    section &&
    isDarkBackgroundColorAttr(section.getAttribute("data-background-color"))
  )
    return "dark";
  return "light";
};

const syncAuditSurfaceTheme = (el) => {
  const section = el.closest("section");
  if (!section) return;
  section.setAttribute("data-audit-surface", resolveAuditSurface(el));
};

/** Dark slide typography when `data-audit-surface="dark"` is set on an ancestor section. */
const auditSurfaceDarkTokens = `
  :host-context([data-audit-surface="dark"]) {
    color: var(--color-page-background);
    --text: var(--color-page-background);
    --text-muted: color-mix(in srgb, var(--color-page-background) 72%, transparent);
    --text-light: color-mix(in srgb, var(--color-page-background) 88%, transparent);
    --section-number: color-mix(in srgb, var(--color-page-background) 38%, transparent);
    --audit-number-emphasis: var(--audit-number-user, var(--color-accent-green));
    --audit-divider-on-surface: color-mix(in srgb, var(--color-page-background) 14%, transparent);
  }
`;

const baseTokens = `
  --color-near-white: #fafafa;
  --color-page-background: #ffffff;
  --color-page-background-alt: #fcfbf7;
  --color-callout-bg: #f5f7fa;
  --color-rule-gray: #e2e5ea;
  --color-text: #181a18;
  --color-alt-text: #545454;
  --color-primary: #3a70b3;
  --color-bright-blue: #2A83F7;
  --color-primary-dark: #193c64;
  --color-dark-surface: #04242b;
  --color-dark-surface-2: #27434d;
  --color-accent-orange: #ffcd74;
  --color-accent-bright-blue: #87d4e9;
  --color-accent-yellow: #fcf496;
  --color-accent-purple: #a998c9;
  --color-accent-green: #86c774;
  --color-dark-purple: #3c194a;
  --color-dark-green: #538c5e;
  --color-light-green: #b3d99a;
  --color-neutral-100: #fafafa;
  --color-neutral-200: #e0e0e0;
  --color-neutral-300: #c7c7c7;
  --color-neutral-400: #aeaeae;
  --color-neutral-500: #969696;
  --color-neutral-600: #7f7f7f;
  --color-neutral-700: #686868;
  --color-neutral-800: #3c3c3c;
  --color-neutral-900: #272727;
  --spacing-space-2xs: 4px;
  --spacing-space-xs: 8px;
  --spacing-space-sm: 12px;
  --spacing-space-md: 16px;
  --spacing-space-lg: 24px;
  --spacing-space-xl: 32px;
  --spacing-space-2xl: 40px;
  --spacing-space-3xl: 48px;
  --spacing-space-4xl: 64px;
  --spacing-space-5xl: 80px;
  --rounded-control: 4px;
  --rounded-container: 8px;
  --typography-hero: 700 100px 'DM Sans';
  --typography-display: 700 45px 'DM Sans';
  --typography-h1: 700 37px 'DM Sans';
  --typography-h2: 700 28px 'DM Sans';
  --typography-body-lg: 400 16px 'DM Sans';
  --typography-body-md: 400 14px 'DM Sans';
  --typography-body-sm: 400 12px 'DM Sans';
  --typography-label-caps: 400 10px 'Geist Mono';
  --typography-kicker: 500 11px 'Geist Mono';
  --typography-code: 400 12px 'Geist Mono';
  /* Audit kit — always use font: var(--typography-*) (full shorthand, DM Sans stack) */
  --typography-audit-cover-title: 600 2em/1.1 'DM Sans';
  --typography-audit-stat-number: 700 2em/1 'DM Sans';
  --typography-audit-stat-label: var(--typography-body-md);
  --typography-audit-strength-title: 600 12px/1.4 'DM Sans';
  --typography-audit-strength-body: 400 13px/1.6 'DM Sans';
  --typography-audit-section-label: 600 11px/1 'DM Sans';
  --typography-audit-display-number: 700 4em/1 'DM Sans';
  --typography-audit-slide-heading: 700 2.4em/1.05 'DM Sans';
  --typography-audit-summary-lede: 700 0.9em/1.35 'DM Sans';
  --typography-audit-recommendation-lede: 400 1.6em/1.3 'DM Sans';
  --typography-audit-finding-headline: 700 1.2em/1.3 'DM Sans';
  --typography-audit-finding-body: 400 14px/1.8 'DM Sans';
  --typography-audit-badge: 700 11px/1 'DM Sans';
  --typography-audit-palette-swatch-name: 500 11px/1 'DM Sans';
  --typography-audit-principle-status: 700 10px/1 'DM Sans';
  --typography-audit-principle-name: 600 14px/1 'DM Sans';
  --typography-audit-principle-detail: 400 12px/1.5 'DM Sans';
  --typography-audit-rec-number: 700 1.8em/1 'DM Sans';
  --typography-audit-rec-body: 400 14px/1.7 'DM Sans';
  --typography-audit-footer-mark: 700 38px/1 'DM Sans';
  --typography-audit-slide-body: 400 14px/1.7 'DM Sans';
  /* Slide chrome — inset of audit-slide / audit-finding content from the section edge */
  --audit-slide-padding: 56px 80px;
  /* Semantic aliases for components (all values trace to --color-* tokens) */
  --text: var(--color-text);
  --text-muted: var(--color-alt-text);
  --text-light: color-mix(in srgb, var(--color-page-background) 85%, transparent);
  --accent: var(--color-accent-yellow);
  --dark: var(--color-dark-surface);
  --section-number: var(--color-neutral-300);
  --brand-icon: url('RMS-lcon.svg');
`;

/* ───────── <audit-cover> ───────── */
class AuditCover extends HTMLElement {
  connectedCallback() {
    syncAuditSurfaceTheme(this);
    const shadow = this.attachShadow({ mode: "open" });
    const bg = this.getAttribute("background") || "";
    const meta = this.getAttribute("meta") || "";
    const logo = this.getAttribute("logo") || "";
    const logoAlt = this.getAttribute("logo-alt") || "";
    const hasNav = this.hasAttribute("nav");
    shadow.innerHTML = `
      <style>
        ${sharedFont}
        :host { ${baseTokens} display: block; height: 100%; color: var(--color-page-background); position: relative; }
        .bg { position: absolute; inset: 0;
          ${bg ? `background-image: url(${bg}); background-size: cover; background-position: center;` : ""}
          z-index: 0; }
        .overlay { position: absolute; inset: 0;
          background: linear-gradient(
            180deg,
            color-mix(in srgb, var(--color-primary-dark) 50%, transparent) 0%,
            color-mix(in srgb, var(--color-primary-dark) 85%, transparent) 70%,
            color-mix(in srgb, var(--color-primary-dark) 95%, transparent) 100%);
          z-index: 1; }
        .content { position: relative; z-index: 2;
          padding: var(--audit-slide-padding); color: var(--color-page-background);
          display: flex; flex-direction: column;
          justify-content: ${bg ? "flex-end" : "center"};
          min-height: 100%; box-sizing: border-box; }
        .meta { font: var(--typography-label-caps); text-transform: uppercase;
          letter-spacing: 2.5px;
          color: color-mix(in srgb, var(--color-page-background) 55%, transparent);
          margin-bottom: var(--spacing-space-md); }
        .logo { height: auto; width: 200px; margin-bottom: var(--spacing-space-xs); }
        ::slotted(h1) {
          font: var(--typography-audit-cover-title) !important;
          color: color-mix(in srgb, var(--color-page-background) 88%, transparent) !important;
          margin: 0 !important;
          letter-spacing: -0.02em !important;
          max-width: 880px !important;
        }
        .nav { position: absolute; bottom: var(--spacing-space-2xl); right: var(--spacing-space-3xl); z-index: 2;
          display: flex; align-items: center; gap: 10px;
          color: color-mix(in srgb, var(--color-page-background) 45%, transparent);
          font: var(--typography-body-sm);
          letter-spacing: 0.5px; cursor: pointer; transition: color 0.2s; }
        .nav:hover { color: color-mix(in srgb, var(--color-page-background) 80%, transparent); }
        .arrow { width: var(--spacing-space-xl); height: var(--spacing-space-xl); border-radius: 50%;
          border: 1.5px solid color-mix(in srgb, var(--color-page-background) 30%, transparent);
          display: flex; align-items: center; justify-content: center; }
        .nav:hover .arrow {
          border-color: color-mix(in srgb, var(--color-page-background) 60%, transparent);
          background: color-mix(in srgb, var(--color-page-background) 8%, transparent); }
        .arrow svg { width: var(--spacing-space-md); height: var(--spacing-space-md); fill: none; stroke: currentColor;
          stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
      </style>
      <div class="bg"></div>
      <div class="overlay"></div>
      <div class="content">
        ${meta ? `<div class="meta">${meta}</div>` : ""}
        ${logo ? `<img class="logo" src="${logo}" alt="${logoAlt}">` : ""}
        <slot></slot>
      </div>
      ${
        hasNav
          ? `
        <div class="nav" onclick="window.Reveal && Reveal.next()">
          <span>Begin</span>
          <div class="arrow"><svg viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6"></polyline></svg></div>
        </div>
      `
          : ""
      }
    `;
  }
}
customElements.define("audit-cover", AuditCover);

/* ───────── <audit-stat> ───────── */
class AuditStat extends HTMLElement {
  connectedCallback() {
    syncAuditSurfaceTheme(this);
    const shadow = this.attachShadow({ mode: "open" });
    const number = this.getAttribute("number") || "";
    shadow.innerHTML = `
      <style>
        ${sharedFont}
        ${auditSurfaceDarkTokens}
        :host { ${baseTokens} display: flex; align-items: flex-start; gap: 28px;
          padding: 20px 0;
          border-top: 1px solid var(--audit-divider-on-surface, var(--color-rule-gray)); }
        :host(:first-of-type) { border-top: none; }
        .num { font: var(--typography-audit-stat-number);
          color: var(--audit-number-emphasis, var(--text));
          min-width: 90px; letter-spacing: -0.02em; }
        .label { font: var(--typography-audit-stat-label); color: var(--text-muted);
          padding-top: 8px; }
      </style>
      <div class="num">${number}</div>
      <div class="label"><slot></slot></div>
    `;
  }
}
customElements.define("audit-stat", AuditStat);

/* ───────── <audit-browser> (attrs: url, src|source, image; slot name="image") ───────── */
class AuditBrowser extends HTMLElement {
  connectedCallback() {
    syncAuditSurfaceTheme(this);
    const image =
      this.getAttribute("image") ||
      "https://ik.imagekit.io/dtunrco/4f2jZugnB-jJQCbbPFvjBkLoOKC67x7yMU6YZH6CMOs.png";
    const shadow = this.attachShadow({ mode: "open" });
    const embedUrlRaw = (() => {
      const direct =
        this.getAttribute("src") ||
        this.getAttribute("source") ||
        this.getAttribute("data-source");
      if (direct && String(direct).trim()) return String(direct).trim();
      if (this.hasAttribute("live") || this.hasAttribute("iframe")) {
        const u = this.getAttribute("url");
        return u && String(u).trim() ? String(u).trim() : "";
      }
      return "";
    })();
    const barUrl =
      (this.getAttribute("url") && String(this.getAttribute("url")).trim()) ||
      embedUrlRaw ||
      "https://www.example.com";
    const loading =
      this.hasAttribute("preload") || this.getAttribute("loading") === "eager"
        ? "eager"
        : "lazy";
    const sandboxDefault =
      "allow-scripts allow-forms allow-popups allow-modals allow-downloads allow-same-origin allow-popups-to-escape-sandbox";
    const sandbox = this.getAttribute("sandbox") || sandboxDefault;
    const escAttr = (s) =>
      String(s ?? "")
        .replace(/&/g, "&amp;")
        .replace(/"/g, "&quot;");
    const escHtml = (s) =>
      String(s ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
    shadow.innerHTML = `
      <style>
        ${sharedFont}
        ${auditSurfaceDarkTokens}
        :host {
          ${baseTokens}
          display: flex;
          flex-direction: column;
          width: 100%;
          height: 100%;
          min-height: 0;
          flex: 1 1 auto;
          box-sizing: border-box;
          margin: 0;
          padding: 0;
        }

        .snapshots-container {
          overflow: hidden;
          border-radius: 8px;
          background-color: #04242B;
          box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05);
          width: 100%;
          box-sizing: border-box;
          
        }

        .snapshots-container:not(.snapshots-container--embed) {
          aspect-ratio: 16 / 10;
        }

        .snapshots-container--embed {
          flex: 1;
          min-height: 0;
          display: flex;
          flex-direction: column;
        }

        .browser-header {
          display: flex;
          flex-direction: column;
          justify-content: center;
          padding: 8px 16px;
          width: 100%;
          overflow: hidden;
        }

        .header-container {
          display: flex;
          flex-wrap: wrap;
          gap: 24px;
          align-items: center;
          width: 100%;
         
        }

        .browser-controls {
          display: flex;
          gap: 10px;
          align-items: center;
          align-self: stretch;
          margin: auto 0;
        }

        .control-dot {
          display: flex;
          flex-shrink: 0;
          align-self: stretch;
          margin: auto 0;
          width: 14px;
          height: 14px;
          border-radius: 50%;
          background-color: #d4d4d8;
        }

        .address-bar-container {
          display: flex;
          flex-wrap: wrap;
          flex: 1;
          flex-shrink: 1;
          gap: 12px;
          align-items: center;
          align-self: stretch;
          margin: auto 0;
          flex-basis: 0;
          min-width: 240px;
          max-width: 90%;
        }

        .navigation-controls {
          display: flex;
          gap: 8px;
          align-items: center;
          align-self: stretch;
          margin: auto 0;
        }

        .nav-icon {
          display: flex;
          flex-shrink: 0;
          align-self: stretch;
          margin: auto 0;
          width: 20px;
          height: 20px;
        }

        .address-bar {
          display: flex;
          flex-wrap: wrap;
          flex: 1;
          flex-shrink: 1;
          gap: 20px;
          align-items: center;
          align-self: stretch;
          padding: 8px 16px 8px 8px;
          margin: auto 0;
          font-size: 12px;
          text-align: center;
          color: white;
          white-space: nowrap;
          border-radius: 4px;
          border: 1px solid #40616E;
          flex-basis: 0;
          min-width: 240px;
          max-width: 78%;
        }

        .address-icon {
          display: flex;
          flex-shrink: 0;
          align-self: stretch;
          margin: auto 0;
          width: 20px;
          height: 20px;
        }

        .url-text {
          flex: 1;
          flex-shrink: 1;
          align-self: stretch;
          margin: auto 0;
          flex-basis: 0;
        }

        .action-buttons {
          display: flex;
          gap: 8px;
          align-items: center;
          align-self: stretch;
          margin: auto 0;
        }

        .action-button {
          display: flex;
          flex-shrink: 0;
          align-self: stretch;
          margin: auto 0;
          width: 20px;
          height: 20px;
          background: none;
          border: none;
          cursor: pointer;
        }

        .main-content {
          display: flex;
          flex: 1;
          flex-direction: column;
          padding: 0 5px 5px 5px ;
          width: 100%;
          min-height: 0;
          border-radius: 0 0 8px 8px;
          overflow: hidden;
        }

        .image-slot {
          width: 100%;
          height: auto;
          display: flex;
          align-items: flex-start;
          justify-content: flex-start;
          padding: 0 10px;
          aspect-ratio: 16 / 10;
          box-sizing: border-box;
        }

        .image-slot--embed {
          flex: 1;
          min-height: 0;
          padding: 0;
          display: flex;
          flex-direction: column;
        }

        .browser-frame {
          flex: 1;
          min-height: 0;
          width: 99%;
          border: 0;
          display: block;
          border-radius: 0 0 4px 4px;
          background: #fff;
        }

        .browser-image {
          width: 100%;
          max-width: 100%;
          max-height: 100%;
          object-fit: contain;
        }

        @media (max-width: 768px) {
          .header-container,
          .address-bar-container,
          .address-bar,
          .url-text {
            max-width: 100%;
          }
        }
      </style>

      <div class="snapshots-container${embedUrlRaw ? " snapshots-container--embed" : ""}">
        <header class="browser-header">
          <div class="header-container">
            <div class="browser-controls">
              <div class="control-dot"></div>
              <div class="control-dot"></div>
              <div class="control-dot"></div>
            </div>
            <div class="address-bar-container">
              <nav class="navigation-controls">
                <div class="nav-icon">
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M3.75033 6.45833H5.83366V5.20833H3.75033V6.45833Z" fill="#EEEFEF" style="fill:#EEEFEF;fill:color(display-p3 0.9336 0.9375 0.9375);fill-opacity:1;"/>
                  <path d="M3.75033 8.95833H5.83366V7.70833H3.75033V8.95833Z" fill="#EEEFEF" style="fill:#EEEFEF;fill:color(display-p3 0.9336 0.9375 0.9375);fill-opacity:1;"/>
                  <path fill-rule="evenodd" clip-rule="evenodd" d="M1.04199 2.5C1.04199 2.15482 1.32181 1.875 1.66699 1.875H18.3337C18.6788 1.875 18.9587 2.15482 18.9587 2.5V17.5C18.9587 17.8452 18.6788 18.125 18.3337 18.125H1.66699C1.32181 18.125 1.04199 17.8452 1.04199 17.5V2.5ZM2.29199 3.125V16.875H7.29199L7.29199 3.125H2.29199ZM17.7087 16.875H8.54199L8.54199 3.125H17.7087V16.875Z" fill="#EEEFEF" style="fill:#EEEFEF;fill:color(display-p3 0.9336 0.9375 0.9375);fill-opacity:1;"/>
                </svg>
                </div>
                <div class="nav-icon">
                  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path fill-rule="evenodd" clip-rule="evenodd" d="M8.38397 9.99983L12.942 5.44174L12.0581 4.55786L6.61621 9.99984L12.0582 15.4417L12.942 14.5579L8.38397 9.99983Z" fill="#EEEFEF" style="fill:#EEEFEF;fill:color(display-p3 0.9336 0.9375 0.9375);fill-opacity:1;"/>
                  </svg>
                </div>
                <div class="nav-icon">
                  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path fill-rule="evenodd" clip-rule="evenodd" d="M7.94252 4.55811L13.3844 10.0001L7.94247 15.442L7.05859 14.5581L11.6167 10.0001L7.05863 5.44198L7.94252 4.55811Z" fill="#EEEFEF" style="fill:#EEEFEF;fill:color(display-p3 0.9336 0.9375 0.9375);fill-opacity:1;"/>
                  </svg>
                </div>
              </nav>
              <div class="address-bar">
                <div class="address-icon">
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
<path d="M10.8411 11.6667H9.16699V13.3334H10.8411V11.6667Z" fill="#EEEFEF" style="fill:#EEEFEF;fill:color(display-p3 0.9336 0.9375 0.9375);fill-opacity:1;"/>
<path fill-rule="evenodd" clip-rule="evenodd" d="M5.62533 5.41675C5.62533 3.0005 7.58408 1.04175 10.0003 1.04175C12.4166 1.04175 14.3753 3.0005 14.3753 5.41675V7.7493C15.6562 8.92948 16.4587 10.6211 16.4587 12.5001C16.4587 16.0669 13.5672 18.9584 10.0003 18.9584C6.43349 18.9584 3.54199 16.0669 3.54199 12.5001C3.54199 10.6211 4.34443 8.92948 5.62533 7.7493V5.41675ZM13.1253 5.41675V6.84678C12.1993 6.33381 11.1339 6.04175 10.0003 6.04175C8.86673 6.04175 7.80135 6.33381 6.87533 6.84678V5.41675C6.87533 3.69086 8.27444 2.29175 10.0003 2.29175C11.7262 2.29175 13.1253 3.69086 13.1253 5.41675ZM10.0003 7.29175C7.12384 7.29175 4.79199 9.6236 4.79199 12.5001C4.79199 15.3766 7.12384 17.7084 10.0003 17.7084C12.8768 17.7084 15.2087 15.3766 15.2087 12.5001C15.2087 9.6236 12.8768 7.29175 10.0003 7.29175Z" fill="#EEEFEF" style="fill:#EEEFEF;fill:color(display-p3 0.9336 0.9375 0.9375);fill-opacity:1;"/>
</svg>

</div>
                <div class="url-text">${escHtml(barUrl)}</div>
                <div class="address-icon">
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M13.3084 1.22481C13.5525 0.980729 13.9482 0.980729 14.1923 1.22481L18.7756 5.80814C19.0197 6.05222 19.0197 6.44795 18.7756 6.69202L14.1923 11.2754C13.9482 11.5194 13.5525 11.5194 13.3084 11.2754L12.1625 10.1295L13.0464 9.24564L13.7503 9.94953L17.4498 6.25008L13.7503 2.55063L10.0509 6.25008L10.7548 6.95397L9.87088 7.83786L8.72505 6.69202C8.48097 6.44795 8.48097 6.05222 8.72505 5.80814L13.3084 1.22481Z" fill="#EEEFEF" style="fill:#EEEFEF;fill:color(display-p3 0.9336 0.9375 0.9375);fill-opacity:1;"/>
                <path d="M13.7753 7.10825L7.10987 13.7748L6.22591 12.891L12.8913 6.22445L13.7753 7.10825Z" fill="#EEEFEF" style="fill:#EEEFEF;fill:color(display-p3 0.9336 0.9375 0.9375);fill-opacity:1;"/>
                <path d="M6.69227 8.72481C6.44819 8.48073 6.05246 8.48073 5.80838 8.72481L1.22505 13.3081C0.980973 13.5522 0.980973 13.9479 1.22505 14.192L5.80838 18.7754C6.05246 19.0194 6.44819 19.0194 6.69227 18.7754L11.2756 14.192C11.5197 13.9479 11.5197 13.5522 11.2756 13.3081L10.1298 12.1623L9.24588 13.0462L9.94978 13.7501L6.25033 17.4495L2.55088 13.7501L6.25033 10.0506L6.95422 10.7545L7.8381 9.87064L6.69227 8.72481Z" fill="#EEEFEF" style="fill:#EEEFEF;fill:color(display-p3 0.9336 0.9375 0.9375);fill-opacity:1;"/>
                </svg>

                </div>
              </div>
              <div class="action-buttons">
                <button class="action-button" aria-label="Download">
                  <div class="nav-icon"><svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
<path d="M11.0164 9.34956L9.5834 10.7827L9.5834 5.625H8.3334V10.7827L6.90035 9.34956L6.01644 10.2334L8.9584 13.1756L11.9004 10.2334L11.0164 9.34956Z" fill="#EEEFEF" style="fill:#EEEFEF;fill:color(display-p3 0.9336 0.9375 0.9375);fill-opacity:1;"/>
<path fill-rule="evenodd" clip-rule="evenodd" d="M8.95833 0C4.01078 0 0 4.01078 0 8.95833C0 13.9059 4.01078 17.9167 8.95833 17.9167C13.9059 17.9167 17.9167 13.9059 17.9167 8.95833C17.9167 4.01078 13.9059 0 8.95833 0ZM1.25 8.95833C1.25 4.70114 4.70114 1.25 8.95833 1.25C13.2155 1.25 16.6667 4.70114 16.6667 8.95833C16.6667 13.2155 13.2155 16.6667 8.95833 16.6667C4.70114 16.6667 1.25 13.2155 1.25 8.95833Z" fill="#EEEFEF" style="fill:#EEEFEF;fill:color(display-p3 0.9336 0.9375 0.9375);fill-opacity:1;"/>
</svg>
</div>
                </button>
                <button class="action-button" aria-label="Add">
                  <div class="nav-icon">
                  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
<path d="M9.37467 10.6249V16.6666H10.6247V10.6249H16.6663V9.37492H10.6247V3.33325H9.37467V9.37492H3.33301V10.6249H9.37467Z" fill="#EEEFEF" style="fill:#EEEFEF;fill:color(display-p3 0.9336 0.9375 0.9375);fill-opacity:1;"/>
</svg>

                  </div>
                </button>
              </div>
            </div>
          </div>
        </header>
        <main class="main-content">
          <div class="image-slot${embedUrlRaw ? " image-slot--embed" : ""}">
          ${
            embedUrlRaw
              ? `<iframe class="browser-frame" src="${escAttr(embedUrlRaw)}" title="Embedded preview" loading="${loading}" referrerpolicy="no-referrer-when-downgrade" sandbox="${escAttr(sandbox)}"></iframe>`
              : `<slot name="image"><img class="browser-image" src="${escAttr(image)}" alt="" /></slot>`
          }
          </div>
        </main>
      </div>


    `;
  }
}
customElements.define("audit-browser", AuditBrowser);

/* ───────── <audit-strength> ───────── */
class AuditStrength extends HTMLElement {
  connectedCallback() {
    syncAuditSurfaceTheme(this);
    const shadow = this.attachShadow({ mode: "open" });
    const title = this.getAttribute("title") || "";
    const legacyColor = cssColorFromAttr(this.getAttribute("color"));
    const titleColor =
      cssColorFromAttr(this.getAttribute("title-color")) || legacyColor;
    const bodyColor =
      cssColorFromAttr(this.getAttribute("body-color")) || legacyColor;
    shadow.innerHTML = `
      <style>
        ${sharedFont}
        ${auditSurfaceDarkTokens}
        :host { ${baseTokens} display: block;
          flex: 0 0 calc(33.333% - 32px);
          padding: 28px 32px 32px 0;
          border-top: 1px solid var(--audit-divider-on-surface, var(--color-rule-gray)); box-sizing: border-box; }
        .title { font: var(--typography-audit-strength-title);
          margin-bottom: 8px;
          color: ${titleColor || "var(--text)"}; letter-spacing: -0.01em; }
        .body { font: var(--typography-audit-strength-body);
          color: ${bodyColor || "var(--text-muted)"}; }
      </style>
      <div class="title">${title}</div>
      <div class="body"><slot></slot></div>
    `;
  }
}
customElements.define("audit-strength", AuditStrength);

/* ───────── <audit-finding> ───────── */
class AuditFinding extends HTMLElement {
  connectedCallback() {
    syncAuditSurfaceTheme(this);
    const shadow = this.attachShadow({ mode: "open" });
    const number = this.getAttribute("number") || "";
    const label = this.getAttribute("label") || "";
    const status = this.getAttribute("status") || "";
    shadow.innerHTML = `
      <style>
        ${sharedFont}
        ${auditSurfaceDarkTokens}
        :host { ${baseTokens} display: block; height: 100%;
          padding: var(--audit-slide-padding); box-sizing: border-box;
          display: flex; flex-direction: column; justify-content: center; }
        .label { font: var(--typography-audit-section-label); text-transform: uppercase;
          letter-spacing: 2.5px; margin-bottom: 16px; color: var(--text-muted); }
        .num { font: var(--typography-audit-display-number);
          color: var(--audit-number-emphasis, var(--section-number));
          margin-bottom: 8px; letter-spacing: -0.02em; }
        .headline { font: var(--typography-audit-finding-headline);
          margin-bottom: 16px; max-width: 680px;
          color: var(--text); letter-spacing: -0.02em; }
        .body { font: var(--typography-audit-finding-body); color: var(--text-muted);
          max-width: 680px; margin-bottom: 16px; }
        .badge { display: inline-flex; align-items: center; gap: 6px;
          font: var(--typography-audit-badge); text-transform: uppercase;
          letter-spacing: 1.5px;
          color: var(--color-dark-green);
          background: color-mix(in srgb, var(--color-accent-green) 22%, var(--color-page-background));
          padding: 4px 12px; border-radius: 4px; align-self: flex-start; }
        ::slotted([slot="screenshot"]) { margin-top: 32px; border-radius: 12px;
          overflow: hidden;
          box-shadow: 0 4px 24px color-mix(in srgb, var(--color-neutral-900) 12%, transparent);
          border: 1px solid var(--color-neutral-200); max-width: 100%; }
      </style>
      ${label ? `<div class="label">${label}</div>` : ""}
      ${number ? `<div class="num">${number}</div>` : ""}
      <div class="headline"><slot name="headline"></slot></div>
      <div class="body"><slot></slot></div>
      ${status ? `<div class="badge">✓ ${status}</div>` : ""}
      <slot name="screenshot"></slot>
    `;
  }
}
customElements.define("audit-finding", AuditFinding);

/* ───────── <audit-palette-row> ───────── */
class AuditPaletteRow extends HTMLElement {
  connectedCallback() {
    syncAuditSurfaceTheme(this);
    const shadow = this.attachShadow({ mode: "open" });
    const label = this.getAttribute("label") || "";
    // swatches passed as: <audit-palette-row swatches='[{"bg":"hsl(46,97%,49%)","label":"base","light":false}, ...]'>
    let swatches = [];
    try {
      swatches = JSON.parse(this.getAttribute("swatches") || "[]");
    } catch {}
    shadow.innerHTML = `
      <style>
        ${sharedFont}
        ${auditSurfaceDarkTokens}
        :host { ${baseTokens} display: block; margin-bottom: 28px; }
        .row-label { font: var(--typography-audit-section-label);
          text-transform: uppercase; letter-spacing: 2px;
          color: var(--text-muted); margin-bottom: 10px; }
        .row { display: flex; gap: 0; border-radius: 8px; contain:paint }
        .sw { flex: 1; height: 80px;
          position: relative; display: flex;
          align-items: flex-end; padding: 8px 12px; box-sizing: border-box; }
        .sw .name { font: var(--typography-audit-palette-swatch-name);
          color: color-mix(in srgb, var(--color-page-background) 100%, transparent); }
        .sw.light .name { color: color-mix(in srgb, var(--color-text) 100%, transparent); }
      </style>
      ${label ? `<div class="row-label">${label}</div>` : ""}
      <div class="row">
        ${swatches
          .map(
            (s) => `
          <div class="sw ${s.light ? "light" : ""}" style="background:${s.bg}">
            <span class="name">${s.label}</span>
          </div>
        `,
          )
          .join("")}
      </div>
    `;
  }
}
customElements.define("audit-palette-row", AuditPaletteRow);

/* ───────── <audit-principle> ───────── */
class AuditPrinciple extends HTMLElement {
  connectedCallback() {
    syncAuditSurfaceTheme(this);
    const shadow = this.attachShadow({ mode: "open" });
    const rawStatus = (this.getAttribute("status") || "pass").toLowerCase();
    const status =
      rawStatus === "opportunity" || rawStatus === "attention"
        ? rawStatus
        : "pass";
    const name = this.getAttribute("name") || "";
    const statusLabels = {
      pass: "Aligned",
      opportunity: "Opportunity",
      attention: "Needs Attention",
    };
    shadow.innerHTML = `
      <style>
        ${sharedFont}
        :host { ${baseTokens} display: block;
          padding: 16px 20px; border-radius: 8px;
          background: var(--color-near-white); border: 1px solid var(--color-neutral-200); }
        .status { display: inline-block; font: var(--typography-audit-principle-status);
          text-transform: uppercase; letter-spacing: 1.5px;
          padding: 3px 10px; border-radius: 4px;
          margin-bottom: 10px; }
        .status-pass {
          background: color-mix(in srgb, var(--color-accent-green) 22%, var(--color-page-background));
          color: var(--color-dark-green); }
        .status-opportunity {
          background: color-mix(in srgb, var(--color-accent-orange) 40%, var(--color-page-background));
          color: var(--color-neutral-900); }
        .status-attention {
          background: color-mix(in srgb, var(--color-accent-purple) 28%, var(--color-page-background));
          color: var(--color-dark-purple); }
        .name { font: var(--typography-audit-principle-name);
          color: var(--color-text); margin-bottom: 6px; letter-spacing: -0.01em; }
        .detail { font: var(--typography-audit-principle-detail); color: var(--color-alt-text); }
      </style>
      <div class="status status-${status}">${statusLabels[status]}</div>
      <div class="name">${name}</div>
      <div class="detail"><slot></slot></div>
    `;
  }
}
customElements.define("audit-principle", AuditPrinciple);

/* ───────── <audit-rec-item> ───────── */
class AuditRecItem extends HTMLElement {
  connectedCallback() {
    syncAuditSurfaceTheme(this);
    const shadow = this.attachShadow({ mode: "open" });
    const number = this.getAttribute("number") || "";
    shadow.innerHTML = `
      <style>
        ${sharedFont}
        ${auditSurfaceDarkTokens}
        :host { ${baseTokens} display: flex; align-items: flex-start; gap: 32px;
          padding: 20px 0;
          border-top: 1px solid var(--audit-divider-on-surface, var(--color-rule-gray)); }
        :host(:first-of-type) { border-top: none; }
        .num { font: var(--typography-audit-rec-number);
          color: var(--audit-number-emphasis, var(--accent));
          min-width: 90px; letter-spacing: -0.02em; }
        .text { font: var(--typography-audit-rec-body); color: var(--text-light);
          padding-top: 10px; max-width: 700px; }
      </style>
      <div class="num">${number}</div>
      <div class="text"><slot></slot></div>
    `;
  }
}
customElements.define("audit-rec-item", AuditRecItem);

/* ───────── <audit-footer> ───────── */
class AuditFooter extends HTMLElement {
  connectedCallback() {
    syncAuditSurfaceTheme(this);
    const shadow = this.attachShadow({ mode: "open" });
    const initial = this.getAttribute("initial") || "R";
    shadow.innerHTML = `
      <style>
        ${sharedFont}
        ${auditSurfaceDarkTokens}
        :host { ${baseTokens} position: absolute; bottom: 40px; right: 60px;
          display: flex; align-items: center; gap: 16px;
          font: var(--typography-body-sm);
          color: var(--text-muted); }
        .icon { width: 32px; height: 32px;
          background: var(--brand-icon); 
          background-size: 100% 100%;
          background-repeat: no-repeat;
          background-position: center;
          background-color: var(--color-bright-blue);
          display: flex;
          align-items: center; justify-content: center;
          font: var(--typography-audit-footer-mark); color: var(--color-near-white); }
      </style>
      <span><slot></slot></span>
      <div class="icon"></div>
    `;
  }
}
customElements.define("audit-footer", AuditFooter);

/* ───────── helpers for plain slide layouts ───────── */
/**
 * <audit-slide variant="light|dark|auto"> wraps slide content with inset padding.
 * Omit variant or use auto: theme follows the section's data-background-color (luminance);
 * slide background stays transparent so Reveal's section color shows through.
 * variant="dark": solid --dark panel plus dark typography.
 * variant="light": force light tokens even on a dark section (rare).
 */
class AuditSlide extends HTMLElement {
  connectedCallback() {
    syncAuditSurfaceTheme(this);
    const variant = this.getAttribute("variant");
    const centered = this.hasAttribute("centered");
    const section = this.closest("section");
    const solidDarkPanel = variant === "dark";
    const darkTypography =
      solidDarkPanel ||
      (variant !== "light" &&
        section &&
        isDarkBackgroundColorAttr(
          section.getAttribute("data-background-color"),
        ));

    if (darkTypography) this.setAttribute("data-audit-dark-heading", "");
    else {
      this.removeAttribute("data-audit-dark-heading");
      this.style.removeProperty("--audit-slide-heading-computed");
    }

    const shadow = this.attachShadow({ mode: "open" });
    shadow.innerHTML = `
      <style>
        ${sharedFont}
        ${auditSurfaceDarkTokens}
        :host { ${baseTokens} display: flex; flex-direction: column; min-height: 0;
          height: 100%;
          padding: var(--audit-slide-padding); box-sizing: border-box;
          ${solidDarkPanel ? "background: var(--dark); color: var(--color-page-background);" : ""}
          ${centered ? "justify-content: center;" : ""}
        }
        ::slotted(audit-browser) {
          flex: 1 1 auto !important;
          min-height: 0 !important;
          width: 100% !important;
          max-width: 100% !important;
          align-self: stretch !important;
        }
        ::slotted(.audit-slide-label) {
          font: var(--typography-audit-section-label) !important;
          text-transform: uppercase !important;
          letter-spacing: 2.5px !important;
          margin-bottom: 16px !important;
          display: block !important;
          flex-shrink: 0 !important;
          color: ${
            darkTypography
              ? "color-mix(in srgb, var(--color-page-background) 55%, transparent)"
              : "var(--text-muted)"
          } !important;
        }
        ::slotted(h2) {
          font: var(--typography-audit-slide-heading) !important;
          margin: 0 0 16px !important;
          letter-spacing: -0.02em !important;
        }
        :host([data-audit-dark-heading]) ::slotted(h2) {
          color: var(--audit-slide-heading-computed, var(--color-accent-green)) !important;
        }
        :host(:not([data-audit-dark-heading])) ::slotted(h2) {
          color: var(--text) !important;
        }
        ::slotted(p) {
          font: var(--typography-audit-slide-body) !important;
          color: ${darkTypography ? "var(--text-light)" : "var(--text-muted)"} !important;
          max-width: 680px !important;
          margin: 0 0 16px !important;
        }
        ::slotted([slot="grid"]) {
          display: flex; flex-wrap: wrap; gap: 0; margin-top: 16px;
        }
        ::slotted([slot="principles"]) {
          display: grid; grid-template-columns: repeat(3, 1fr);
          gap: 12px; margin-top: 16px;
        }
      </style>
      <slot name="label-content"></slot>
      <slot></slot>
      <slot name="grid"></slot>
      <slot name="principles"></slot>
      <slot name="footer"></slot>
    `;

    if (darkTypography) {
      queueMicrotask(() => this.#computeDarkHeadingColor());
    }

    const label = this.getAttribute("label");
    if (label) {
      const labelEl = document.createElement("div");
      labelEl.setAttribute("slot", "label-content");
      labelEl.className = "audit-slide-label";
      labelEl.textContent = label;
      this.prepend(labelEl);
    }
  }

  /** Slotted h2 color must survive Reveal's `section { color: white }`; resolve var() on this host. */
  #computeDarkHeadingColor() {
    if (!this.isConnected || !this.hasAttribute("data-audit-dark-heading"))
      return;
    const probe = document.createElement("span");
    probe.hidden = true;
    probe.style.cssText =
      "position:absolute;left:0;top:0;width:0;height:0;overflow:hidden;color:var(--audit-slide-heading-user, var(--color-accent-green))";
    this.appendChild(probe);
    const computed = getComputedStyle(probe).color;
    probe.remove();
    if (computed && computed !== "rgba(0, 0, 0, 0)") {
      this.style.setProperty("--audit-slide-heading-computed", computed);
    }
  }
}
customElements.define("audit-slide", AuditSlide);
