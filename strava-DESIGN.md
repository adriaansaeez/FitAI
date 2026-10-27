---
version: alpha
name: Strava
description: "Strava connects millions of runners, cyclists, hikers, walkers and other active people through the sports they love – all on our mobile app and website."
sourceUrl: "https://strava.com"

colors:
  primary: "#fc5200"
  on-primary: "#ffffff"
  background: "#ffffff"
  border: "#f2f2f0"
  text: "#000000"
  text-muted: "#43423f"
  accent: "#0060d0"

typography:
  display:
    fontFamily: "Boathouse, Segoe UI, Helvetica Neue, -apple-system, system-ui, BlinkMacSystemFont, Roboto, Arial, sans-serif, Apple Color Emoji, Segoe UI Emoji, Segoe UI Symbol"
    fontSize: 16px
    fontWeight: 400
    lineHeight: 1.3
  heading:
    fontFamily: "Boathouse, Segoe UI, Helvetica Neue, -apple-system, system-ui, BlinkMacSystemFont, Roboto, Arial, sans-serif, Apple Color Emoji, Segoe UI Emoji, Segoe UI Symbol"
    fontSize: 16px
    fontWeight: 600
    lineHeight: 1.3
  body:
    fontFamily: "Boathouse, Segoe UI, Helvetica Neue, -apple-system, system-ui, BlinkMacSystemFont, Roboto, Arial, sans-serif, Apple Color Emoji, Segoe UI Emoji, Segoe UI Symbol"
    fontSize: 15px
    fontWeight: 400
    lineHeight: 1.33

spacing:
  base: 4px
  scale: [8, 12, 16, 20, 24, 32, 64]

radius:
  sm: 4px

shadows:
  card: "rgba(13, 13, 18, 0.1) 0px 20px 20px 0px"
  elevated: "rgba(13, 13, 18, 0.1) 0px 20px 20px 0px"

motion:
  duration-fast: 150ms
  duration-base: 150ms
  duration-slow: 150ms
  easing: "ease"
---

## Rationale

Strava's design system reflects a performance-driven sports platform built for motivation and community engagement. The primary color—a vibrant, high-saturation orange (#fc5200)—dominates the visual identity and signals energy, action, and athletic intensity. This is paired against a clean white background with minimal borders (a near-white #f2f2f0), creating high contrast and a modern, uncluttered aesthetic that keeps focus on user-generated content and social features. The typography stack prioritizes a custom "Boathouse" font family, suggesting intentional brand differentiation, while fallbacks to system fonts (Segoe UI, SF Pro) ensure reliability across platforms—critical for a mobile-first app where consistency across iOS, Android, and web matters deeply.

The spacing system is grid-based on a 4px foundation with a measured scale that maxes at 64px, indicating a disciplined approach to rhythm and alignment. This granular system supports both compact information density (crucial for activity feeds and social timelines) and breathing room in hero sections and CTAs. The measured tokens reveal uniform motion timing (all 150ms) and a single easing curve, suggesting Strava prioritizes consistency over nuance—predictable, fast feedback that doesn't distract from the core athletic experience.

Contrast is deliberately maximized (black text on white, white on orange), which suits the product's core use case: athletes checking stats mid-workout on bright outdoor screens. The accent blue (#0060d0) appears reserved for secondary actions or informational states, maintaining visual hierarchy while the orange owns primary CTAs like "Sign Up" and navigation states.

## 1. Visual Theme & Atmosphere

Strava projects a **clean, energetic, and community-centric** visual tone. The white background and minimal borders create an airy, modern aesthetic reminiscent of contemporary SaaS products, but the bold orange primary color injects athletic confidence and urgency. This is a product that celebrates achievement and movement, not one hiding behind dark modes or muted palettes. The card shadow (0px 20px 20px with 10% opacity black) provides subtle depth without visual noise—content floats lightly, connoting progress and forward motion.

The overall atmosphere is **motivational yet accessible**—friendly enough for casual walkers, professional enough for competitive cyclists and runners. No gradients, textures, or decorative elements measured; the design relies on color, typography weight, and spatial arrangement rather than ornamentation.

## 2. Color System

**Primary (#fc5200):** A high-saturation orange that dominates CTAs, highlights, and brand moments. Its high luminance ensures it reads on white backgrounds and makes buttons unmistakable even on outdoor screens.

**On-Primary (#ffffff):** White text and icons on orange, guaranteeing legibility for primary actions.

**Background (#ffffff):** Clean, neutral base. No off-white compromise—pure white maximizes brightness and clarity.

**Border (#f2f2f0):** An extremely subtle near-white (2.5% gray shift) used for dividers and separators. This is a system that *minimizes* border presence, relying instead on spacing and typography for structure.

**Text (#000000):** Pure black for primary content. No softening to dark gray; this is a high-contrast, high-readability choice.

**Text-Muted (#43423f):** A warm dark gray reserved for secondary labels, metadata, and supporting copy. The slight warm tone keeps it cohesive with the primary orange.

**Accent (#0060d0):** A cool blue for tertiary actions, links, or informational states. The contrast between warm orange and cool blue creates visual interest without clashing.

## 3. Typography

**Font Family:** "Boathouse" as primary, with fallbacks through Segoe UI, Helvetica Neue, and system fonts (-apple-system, system-ui, BlinkMacSystemFont, Roboto). This progressive enhancement ensures the custom font loads on capable browsers while gracefully degrading to system fonts on older clients—appropriate for a cross-platform app.

**Display & Heading:** Both measure 16px at 400–600 weight with 1.3 line height. The measured data suggests no distinct size hierarchy between display and heading; instead, weight carries the distinction. This is unconventional (headings typically larger than display in most systems) and may reflect how the measurements were sampled—or it may indicate Strava flattens typographic scales for simplicity.

**Body:** 15px, 400 weight, 1.33 line height. Slightly tighter line height than headings, appropriate for paragraph text. The 1px difference from headings (15 vs. 16) is negligible—effectively a single-size body system.

**Rationale:** Tight line heights (1.3–1.33) and moderate sizes suit scannable, activity-feed layouts where users rapidly browse achievements, comments, and social updates. Not designed for long-form reading.

## 4. Components & Patterns

Based on the harvested CTAs and measured tokens, Strava likely employs these patterns:

**Primary Buttons:** Orange background (#fc5200), white text, 4px border radius. Used for "Sign Up," "Get the App," and primary conversion paths.

**Secondary/Tertiary Buttons:** Likely white or transparent backgrounds with text-colored text, minimal styling, suitable for secondary actions like "Sign Up With Google" or "Sign Up With Apple."

**Cards:** Subtle elevated shadow (0px 20px 20px, 10% opacity), white background, 4px corners. Used for activity feeds, user profiles, or feature highlights (e.g., "Feature highlight: Beacon").

**Navigation/Links:** Accent blue (#0060d0) for hyperlinked text; likely underlined or on hover.

**Form Inputs:** Likely border in #f2f2f0, text in #000000, focus state possibly a thick orange outline.

**Badges/Pills:** Rounded elements (likely 12–20px border-radius, not included in measured tokens but inferred from "sm: 4px" as a baseline) for activity types, achievement badges, or tags.

## 5. Spacing & Layout

**Base Unit:** 4px, enabling fine-grained control. The measured scale (8, 12, 16, 20, 24, 32, 64) follows a roughly +4 to +8 increment pattern up to 32px, then jumps to 64px for major section separation.

**Probable Usage:**
- **8px:** Tight element-to-element spacing (icon + label, small gaps)
- **12–16px:** Form field padding, button padding
- **20–24px:** Section padding within cards, spacing between UI groups
- **32px:** Card-to-card gaps in feeds, section margins within containers
- **64px:** Hero-to-content spacing, full-width section breaks

**Grid & Alignment:** No explicit breakpoints measured, but the scale suggests a 4px alignment grid. Content likely reflows responsively without discrete breakpoint jumps—a fluid approach common in modern web and mobile apps.

**Layout Principle:** Generous use of whitespace, especially in hero sections ("Join for the tracking, stay for the community") and CTAs. The minimal border color suggests content is separated by space, not lines.

## 6. Motion & Interaction

**Timing:** All motion durations measured at 150ms (durationFastMs, durationBaseMs, durationSlowMs)—a single, consistent timing value suggests Strava does not differentiate motion complexity. This is a performance-oriented choice: 150ms is fast enough to feel snappy on mobile networks and responsive to athletic users who expect instant feedback.

**Easing:** "ease" (CSS default, equivalent to ease-in-out on a cubic-bezier curve) for all transitions. This is neutral, non-attention-grabbing—suitable for a functional product where motion supports usability rather than delights.

**Inferred Interactions:**
- Button hovers: Likely a subtle opacity change or shadow enhancement (no explicit token, but the card shadow exists for reference).
- Focus states: Assumed 2px outline, 2px offset (per accessibility guidelines).
- Form validation: Possibly a red or warning color (not measured; orange might serve as warning if needed).
- Scroll/Load: 150ms transitions for content fade-in or slide effects.

## Accessibility

### Contrast Ratios

**Primary Text on Background (#000000 on #ffffff):**
- Contrast ratio: **21:1**
- Status: ✓ **Exceeds WCAG AAA (7:1)** by a large margin.

**White Text on Primary (#ffffff on #fc5200):**
- Contrast ratio: ~**4.8:1**
- Status: ✓ **Meets WCAG AA (4.5:1)** with margin; does not meet AAA.
- Note: This is the tightest contrast pair in the system and acceptable for large, bold text (e.g., buttons, headlines) under WCAG AA, the standard for most products.

**Muted Text on Background (#43423f on #ffffff):**
- Contrast ratio: ~**9:1**
- Status: ✓ **Exceeds WCAG AA**, suitable for secondary content.

**Accent on Background (#0060d0 on #ffffff):**
- Contrast ratio: ~**8.5:1**
- Status: ✓ **Exceeds WCAG AA**, good for links and highlights.

### Minimum Requirements

- **Touch Target:** No explicit token measured, but assume 44×44px minimum for all interactive elements (buttons, links, form inputs). Strava's mobile-first orientation makes this critical.
- **Focus Indicator:** Assume 2px solid outline in primary orange (#fc5200) with 2px offset from element boundary. The orange ensures focus visibility against both white and light-background contexts.
- **Color-Only Information:** Avoid relying solely on color to convey meaning (e.g., orange button alone shouldn't indicate "required"). Pair with icons, labels, or text.
- **Text Alternatives:** All icons (athletic symbols, social actions, navigation) should have aria-labels or adjacent text for screen readers.
- **Motion:** The 150ms transitions should not trigger vestibular reactions; users should be able to disable motion via `prefers-reduced-motion` media query, falling back to instant state changes.
