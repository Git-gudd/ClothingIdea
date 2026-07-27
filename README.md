# Outfit Library

A personal, searchable gallery of outfit inspiration. Static HTML, CSS and
vanilla JavaScript — no build step, no frameworks, no backend.

## Files

```
index.html    markup and the lightbox shell
style.css     dark theme, responsive masonry gallery
script.js     loads data.json once, filters in memory
data.json     all outfit metadata
Images/       the outfit photos
```

## Running it

`data.json` is loaded with `fetch`, which browsers block on `file://` URLs, so
opening `index.html` by double-clicking will show a load error. Use any static
server:

```sh
python3 -m http.server 8000
# then open http://localhost:8000
```

On GitHub Pages it just works — enable Pages for the repository (Settings →
Pages → deploy from branch) and visit the published URL.

## Adding an outfit

1. Drop the photo in `Images/`.
2. Append an object to the array in `data.json`.

Only `id` and `image` are actually required. Everything else is optional, and
**you can invent new attributes freely** — the search index and the detail panel
both walk the object recursively, so a new field becomes searchable and visible
without touching `script.js`.

```json
{
  "id": 26,
  "image": "Images/Picture27.png",
  "title": "Grey crewneck with black jeans",

  "outer":  { "type": "Bomber jacket", "color": "Black", "fit": "Regular" },
  "top":    { "type": "Sweatshirt", "color": "Grey", "fit": "Relaxed" },
  "bottom": { "type": "Jeans", "color": "Black", "fit": "Slim" },
  "shoes":  { "type": "Sneakers", "color": "White" },

  "accessories": ["Silver chain necklace"],
  "season":      ["Fall"],
  "occasion":    ["Casual"],
  "style":       ["Minimal", "Streetwear"],
  "keywords":    ["easy", "everyday"],
  "notes": ""
}
```

Notes on the conventions used here:

- `image` paths are case-sensitive on GitHub Pages — the folder is `Images/`.
- `outer` is the outer layer (jacket, overshirt, cardigan). Omit it when there
  isn't one.
- Keys listed in `FIELD_ORDER` in `script.js` are shown first in the detail
  panel; anything else is appended in the order it appears in the JSON.
- Gallery cards show `season` as plain tags and `style` as blue tags.

## Searching

Every value **and** every field name is indexed, at any nesting depth. Matching
is case-insensitive and partial, and punctuation is ignored, so `tshirt` finds
`T-shirt`.

| You type | You get |
| --- | --- |
| `black` | anything black, anywhere in the record |
| `black summer` | outfits matching **both** words |
| `black oversized tshirt` | all three, across different attributes |
| `"coffee date"` | that exact phrase |
| `season:summer` | scoped to the `season` field |
| `color:black` | scoped to any `*.color` field — top, bottom, shoes… |

Field prefixes match any path containing that name, so `type:jeans` checks
`top.type`, `bottom.type` and `shoes.type` alike.

## Keyboard

| Key | Action |
| --- | --- |
| `/` | jump to the search box |
| `Esc` | clear the search, or close the preview |
| `←` `→` | previous / next outfit in the preview |

The preview also closes by clicking the backdrop or the × button.
