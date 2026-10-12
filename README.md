# SVG Editor

<img src="public/logo.svg" width="64" height="64" alt="SVG Editor logo" align="right" />

A browser-based editor for working directly on raw SVG. Load an SVG, change it visually or in code — the output is always clean SVG again.

Built with React, TypeScript and Vite. Everything runs locally in the browser, no backend.

## Features

**Layout**
- Tool rail on the left, layers next to it, a tabbed inspector on the right (**Design · Pfad · Code · Verlauf**, plus **Knoten** while editing nodes) and a status bar with pointer position, selection size and minified file size
- A floating **context bar** above the selection (combine, center, offset, edit nodes, duplicate, delete) and below the selected node (node type, split, delete)
- **Command palette** (`⌘K`): search and run every command, with recently used commands first

**Editing**
- Select by click, Shift+click or marquee; `⌘A` selects everything, `⌘`+click selects inside groups
- Move (drag / arrow keys), scale with 8 handles, rotate with the rotate handle
- Numeric X / Y / width / height with a 9-point **reference point** (top left … center … bottom right), scale in %, rotate, flip
- Align and distribute, arrange (front/back), group / ungroup, duplicate, copy / cut / paste
- Transforms are written straight into the geometry (path data, `x`/`y`, `cx`/`cy`, …) instead of piling up `transform` attributes — optional, with stroke-width scaling
- Node editing for paths: drag anchors and control points, switch nodes between corner / smooth / symmetric, set node positions numerically, add nodes by double-clicking the outline, delete with `⌫`, split, close / open and reverse paths
- Undo / redo with a clickable history

**Shapes**
- Rectangle, square, circle, ellipse, triangle, polygon, star, arrow, line, cross, heart
- Drag to draw (Shift = proportional / 45°, Alt = from center) or click for a default size
- Configurable fill, stroke, star points / inner radius and polygon sides
- **Pen tool** (`P`): click for corner points, drag for smooth curve points (Shift = 45°), click the first point to close the path, `Enter` or double-click to finish, `⌫` removes the last point

**Path tools**
- **Offset** (grow / shrink): builds a border of 2 × distance around the visible shape (fill + stroke) and unites it with or cuts it from the shape; miter, round or bevel corners
- Parallel offset that keeps curves (useful for open lines)
- **Boolean operations:** union, subtract, intersect, exclude
- **Round corners** for rectangles, polygons and paths
- Stroke to fill, shape to path, apply transforms

**Appearance**
- Fill, stroke, opacity, stroke width, line cap, line join, fill rule, dash array
- Document palette: recolor a color everywhere at once
- Raw attribute editor for the selected element

**Code & export**
- Live, two-way synced code editor (CodeMirror)
- Minify with SVGO (precision, multipass, keep IDs), format / pretty print
- Preview at 16–64 px on dark and light backgrounds
- Download, copy to clipboard, open files or drag & drop them onto the canvas, paste SVG code with `⌘V`
- Work is saved in the browser automatically; the **recent list** in the toolbar keeps previously opened and edited SVGs (with thumbnails, rename, search, remove) in `localStorage`

## Keyboard shortcuts

| Keys | Action |
| --- | --- |
| `⌘K` | Command palette |
| `⌘Z` / `⇧⌘Z` | Undo / redo |
| `⌘A` | Select all |
| `⌘C` / `⌘X` / `⌘V` | Copy / cut / paste (also raw SVG code) |
| `⌘D` | Duplicate |
| `⌫` | Delete |
| `⌘G` / `⇧⌘G` | Group / ungroup |
| `⌘]` / `⌘[` | Bring forward / send backward (with `⇧`: to front / back) |
| Arrow keys | Move by 1 (`⇧` 10, `⌥` 0.1) |
| `V` / `A` / `H` | Select / node / hand tool |
| `R` / `O` / `L` / `S` | Draw rectangle / circle / line / star |
| Double click / `Enter` | Enter group / edit path nodes |
| `Esc` | Clear selection / leave mode |
| Space + drag, `⌘` + scroll | Pan, zoom |
| `⌘0` / `⌘1` | Zoom to fit / 100 % |
| `⌘S` / `⌘O` | Download / open |

On Windows and Linux use `Ctrl` instead of `⌘`.

## Getting started

Requires Node.js 20 or newer.

```bash
npm install
npm run dev      # development server on http://localhost:5173
npm run build    # production build into dist/
npm run preview  # serve the production build
```

## Deployment

A GitHub Actions workflow (`.github/workflows/deploy.yml`) builds the app and publishes it to GitHub Pages on every push to `main`. Enable it once under **Settings → Pages → Source: GitHub Actions**.

The build uses relative asset paths, so it works under any repository name.

## Project structure

```
src/
  App.tsx              layout, toolbar, keyboard shortcuts
  store.ts             state: document, history, selection, settings
  actions.ts           editor commands used by the UI
  commands.ts          command list for the palette
  components/
    Canvas.tsx         rendering, selection, handles, drawing, node editing
    Properties.tsx     inspector tabs (design, path, nodes)
    Layers.tsx         layer tree
    RightPanel.tsx     inspector, code editor, history, export
    ToolRail.tsx       tool bar on the left
    ShapePicker.tsx    shape flyout in the tool bar
    ContextBar.tsx     floating actions for selection and nodes
    CommandPalette.tsx ⌘K command search
    StatusBar.tsx      status bar
    RecentMenu.tsx     recently edited documents
  lib/
    matrix.ts          2D affine matrices and transform parsing
    path.ts            path parsing, normalisation, transforms, flattening
    ops.ts             document operations (transform, group, offset, booleans, …)
    area.ts            polygon geometry with Clipper (offsets, booleans)
    offset.ts          curve-preserving parallel offset, stroke outline
    shapes.ts          shape generators and corner rounding
    svg.ts             parsing, sanitising, element IDs, colors
    minify.ts          SVGO wrapper
    nodes.ts           path node model (corner / smooth / symmetric)
    recent.ts          recent documents in localStorage
```

## Limitations

- Offset and boolean results consist of straight segments (many points on curves); run Minify to shrink them
- Colors set via CSS classes in `<style>` blocks are not read
- Stroke to fill ignores dash arrays

## Tech

[React](https://react.dev) · [TypeScript](https://www.typescriptlang.org) · [Vite](https://vite.dev) · [Zustand](https://zustand.docs.pmnd.rs) · [SVGO](https://svgo.dev) · [Clipper](https://sourceforge.net/projects/jsclipper/) · [CodeMirror](https://codemirror.net) · [Lucide](https://lucide.dev)
