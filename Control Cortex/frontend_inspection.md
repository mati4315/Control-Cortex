# Control Cortex Frontend Layout & CSS Structure Inspection

This document contains a comprehensive technical breakdown of the Control Cortex user interface layout, the design system, the dynamic rendering of microservice cards inside `.services-grid`, and their real-time state management.

---

## 1. Page Layout & Grid System

The page is built using HTML5 semantic containers styled with a layout based on **CSS Grid** and **Flexbox** to keep panels locked cleanly within the viewport.

### Desktop Layout (`width > 1200px`)
- **Main Container:** `.app-container` has a flex layout (`display: flex; flex-direction: column; min-height: 100vh;`).
- **Workspace Partitioning:** `.main-content` is structured as a two-column CSS Grid:
  ```css
  .main-content {
    display: grid;
    grid-template-columns: 1.1fr 0.9fr;
    gap: 24px;
    flex-grow: 1;
  }
  ```
  - **Left Column:** Services section (`.services-section`), which holds the list of registered services.
  - **Right Column:** Console section (`.console-section`), which contains the real-time terminal output.

### Responsive Layout (`width <= 1200px`)
- When the screen width falls below 1200px, a media query changes the main layout to a single column:
  ```css
  @media (max-width: 1200px) {
    .main-content {
      grid-template-columns: 1fr;
    }
  }
  ```

### Height Constraints & Scrollbars
To avoid long page-scrolling and create a premium application feel:
- Both `.services-section` and `.console-section` are restricted to a maximum height of `80vh` (`max-height: 80vh`).
- Content overflow inside these sections is handled using `overflow-y: auto`.
- The panels have customized scrollbars (`::-webkit-scrollbar`) with subtle transparent tracks and high-contrast hover styles to match the dark glassmorphic theme.

---

## 2. Services Grid Layout (`.services-grid`)

The container for all the service cards (`#services-container`) is styled with `.services-grid`:

```css
.services-grid {
  overflow-y: auto;
  flex-grow: 1;
  display: grid;
  grid-template-columns: 1fr;
  gap: 16px;
  padding-right: 6px;
}
```

### Key Behaviors:
- **Single-Column Grid:** Service cards are stacked in a single column (`grid-template-columns: 1fr`).
- **Growth:** If you want to change this to a multi-column card layout on widescreen monitors, you can update `grid-template-columns` to:
  ```css
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  ```

---

## 3. Service Card Structure & Rendering

Service cards are generated dynamically inside `app.js` within the `renderServicesGrid()` function.

### DOM Node Anatomy
Each service card is represented by a `div` element with the following template:

```html
<div class="service-card status-online active-selected" id="card-modulo-de-tiempo-y-clima" data-id="modulo-de-tiempo-y-clima">
  <!-- Card Header -->
  <div class="card-top">
    <div class="card-title-info">
      <h3>Clima y Tiempo</h3>
      <span class="card-desc">Overlay de reloj y clima en vivo para OBS</span>
    </div>
    <span class="card-status status-badge-online">
      <i class="fa-solid fa-circle"></i> online
    </span>
  </div>

  <!-- Resource Metrics -->
  <div class="card-middle">
    <div class="metric-item">
      <span class="metric-label">CPU</span>
      <span class="metric-val" id="cpu-modulo-de-tiempo-y-clima">2.4%</span>
    </div>
    <div class="metric-item">
      <span class="metric-label">Memoria</span>
      <span class="metric-val" id="mem-modulo-de-tiempo-y-clima">14.6 MB</span>
    </div>
    <div class="metric-item">
      <span class="metric-label">Uptime</span>
      <span class="metric-val" id="uptime-modulo-de-tiempo-y-clima">3h 4m 12s</span>
    </div>
    <div class="metric-item">
      <span class="metric-label">Restarts</span>
      <span class="metric-val" id="restarts-modulo-de-tiempo-y-clima">0</span>
    </div>
  </div>

  <!-- Control Actions -->
  <div class="card-actions">
    <div class="action-buttons">
      <!-- Contextual Start/Stop/Restart Buttons -->
      <button class="btn btn-danger btn-sm action-stop-btn">Detener</button>
      <button class="btn btn-secondary btn-sm action-restart-btn"><i class="fa-solid fa-arrows-rotate"></i></button>
      <!-- Optional external link to microservice dashboard -->
      <a href="http://localhost:3757/dashboard.html" target="_blank" class="btn btn-secondary btn-icon"><i class="fa-solid fa-up-right-from-square"></i></a>
    </div>
    <!-- Delete from registry button -->
    <button class="btn btn-icon btn-secondary btn-delete"><i class="fa-solid fa-trash-can"></i></button>
  </div>
</div>
```

---

## 4. CSS Styling System for Cards

The visual behavior of cards depends on their active state and operational status.

### Glassmorphism & Borders
- **Default State:** Base background is translucent dark gray (`background: rgba(255, 255, 255, 0.015);`) with a light semitransparent border (`border: 1px solid var(--border-light);`).
- **Interactive States:** On hover, cards slide up slightly (`transform: translateY(-2px);`) and transition background opacity (`background: var(--bg-panel-hover);`) with a shadow drop.
- **Selected State (`.active-selected`):** Adding this class highlights the card with a purple primary-color border and glow:
  ```css
  .service-card.active-selected {
    background: rgba(99, 102, 241, 0.08);
    border-color: var(--primary);
    box-shadow: 0 0 15px rgba(99, 102, 241, 0.15);
  }
  ```

### Status Indicators (`::before` Glow Strip)
A status colored vertical strip is rendered on the left edge of each card using `::before`:
- **`status-online`**: Green bar (`var(--success)`) + subtle green shadow glow.
- **`status-stopped`**: Red bar (`var(--danger)`) + subtle red shadow glow.
- **`status-restarting`**: Amber bar (`var(--warning)`) + subtle amber shadow glow.

### Status Badges (`.card-status`)
Contextual badges indicating service state:
- `.status-badge-online`: `background: rgba(16, 185, 129, 0.12); color: var(--success); border: 1px solid rgba(16, 185, 129, 0.25);`
- `.status-badge-stopped`: `background: rgba(239, 68, 68, 0.12); color: var(--danger); border: 1px solid rgba(239, 68, 68, 0.25);`
- `.status-badge-restarting`: `background: rgba(245, 158, 11, 0.12); color: var(--warning); border: 1px solid rgba(245, 158, 11, 0.25);`

---

## 5. Dynamic Rendering & Performance Optimization

To prevent expensive DOM rebuilds during periodic updates, the dashboard implements a dual-mode rendering cycle:

1. **Initial / Structural Changes (`renderServicesGrid()`):**
   - Executed when fetching the service list for the first time, adding/removing a service, or changing layout.
   - Clears and rebuilds the inner HTML of `#services-container`.
2. **Real-time Metric Stream (`handleWebSocketMetrics()`):**
   - Invoked every 3 seconds via the WebSocket stream.
   - Modifies values directly in the DOM using specific element IDs:
     - `#cpu-{serviceId}`
     - `#mem-{serviceId}`
     - `#uptime-{serviceId}`
     - `#restarts-{serviceId}`
   - Directly mutates the parent card's class names and adjusts control buttons dynamically (`.action-buttons`) without rebuilding the card. This ensures optimal rendering performance even with rapid socket streams.
