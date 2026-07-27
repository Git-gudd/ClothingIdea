/* ==========================================================================
   Outfit Library
   Loads data.json once, then filters entirely in memory.

   The search index is built by walking each outfit object recursively, so any
   attribute added to data.json later becomes searchable without touching this
   file.
   ========================================================================== */

(function () {
  'use strict';

  var DATA_URL = 'data.json';

  /* Keys that describe the file rather than the outfit. Indexed nowhere so a
     search for "png" or "picture" doesn't match every card. */
  var IGNORED_KEYS = { image: true };

  /* Order preferred in the lightbox; anything not listed is appended after,
     in the order it appears in the JSON. */
  var FIELD_ORDER = [
    'outer', 'top', 'mid', 'bottom', 'shoes', 'accessories',
    'season', 'occasion', 'style', 'keywords', 'notes'
  ];

  var outfits = [];      // raw records, each with a private _search index
  var visible = [];      // currently filtered records, in gallery order
  var lightboxIndex = -1;
  var lastFocused = null;

  var els = {
    gallery: document.getElementById('gallery'),
    search: document.getElementById('search'),
    clear: document.getElementById('clear-search'),
    count: document.getElementById('count'),
    status: document.getElementById('status'),
    empty: document.getElementById('empty'),
    lightbox: document.getElementById('lightbox'),
    lbPanel: document.getElementById('lb-panel'),
    lbImage: document.getElementById('lb-image'),
    lbTitle: document.getElementById('lb-title'),
    lbList: document.getElementById('lb-list'),
    lbDetails: document.getElementById('lb-details'),
    lbClose: document.getElementById('lb-close'),
    lbPrev: document.getElementById('lb-prev'),
    lbNext: document.getElementById('lb-next')
  };

  /* ------------------------------------------------------------------------
     Text helpers
     ---------------------------------------------------------------------- */

  function normalize(value) {
    return String(value)
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')   // drop accents
      .replace(/\s+/g, ' ')
      .trim();
  }

  /* "T-shirt" also needs to match a search for "tshirt", so every phrase is
     stored twice: as written, and with punctuation removed. */
  function variants(value) {
    var base = normalize(value);
    var stripped = base.replace(/[^a-z0-9 ]+/g, '');
    return stripped && stripped !== base ? [base, stripped] : [base];
  }

  function prettyLabel(key) {
    var spaced = key.replace(/[_.]/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2');
    return spaced.charAt(0).toUpperCase() + spaced.slice(1);
  }

  /* ------------------------------------------------------------------------
     Indexing — walk anything, at any depth
     ---------------------------------------------------------------------- */

  function walk(value, path, fields) {
    if (value === null || value === undefined || value === '') return;

    if (Array.isArray(value)) {
      value.forEach(function (item) { walk(item, path, fields); });
      return;
    }

    if (typeof value === 'object') {
      Object.keys(value).forEach(function (key) {
        if (path.length === 0 && IGNORED_KEYS[key]) return;
        walk(value[key], path.concat(key), fields);
      });
      return;
    }

    fields.push({ path: path.join('.'), text: String(value) });
  }

  function buildIndex(outfit) {
    var fields = [];
    walk(outfit, [], fields);

    var parts = [];
    fields.forEach(function (field) {
      /* Field names are searchable too, so "season" or "top.color" hit even
         though the user never has to type them. */
      parts.push(field.path.replace(/\./g, ' '));
      parts.push(field.path);
      parts.push(field.text);
    });

    var haystack = [];
    parts.forEach(function (part) {
      variants(part).forEach(function (v) { haystack.push(v); });
    });

    return {
      haystack: ' ' + haystack.join(' ') + ' ',
      fields: fields.map(function (field) {
        return { path: normalize(field.path), text: variants(field.text).join(' ') };
      })
    };
  }

  /* ------------------------------------------------------------------------
     Query parsing

     - bare words are ANDed:            black summer
     - "quoted phrases" match exactly:  "coffee date"
     - field:value scopes one attribute: season:summer, color:black
     ---------------------------------------------------------------------- */

  function parseQuery(raw) {
    var terms = [];
    var pattern = /(?:([a-z0-9_.]+):)?(?:"([^"]*)"|(\S+))/gi;
    var match;

    while ((match = pattern.exec(raw)) !== null) {
      var value = match[2] !== undefined ? match[2] : match[3];
      if (!value) continue;

      var normalized = normalize(value);
      if (!normalized) continue;

      terms.push({
        field: match[1] ? normalize(match[1]) : null,
        value: normalized,
        alt: normalized.replace(/[^a-z0-9 ]+/g, '')
      });
    }

    return terms;
  }

  function termMatches(index, term) {
    if (term.field) {
      return index.fields.some(function (field) {
        if (field.path.indexOf(term.field) === -1) return false;
        return field.text.indexOf(term.value) !== -1 ||
               (term.alt && field.text.indexOf(term.alt) !== -1);
      });
    }

    return index.haystack.indexOf(term.value) !== -1 ||
           (!!term.alt && index.haystack.indexOf(term.alt) !== -1);
  }

  function filter(query) {
    var terms = parseQuery(query);
    if (terms.length === 0) return outfits.slice();

    return outfits.filter(function (outfit) {
      return terms.every(function (term) {
        return termMatches(outfit._index, term);
      });
    });
  }

  /* ------------------------------------------------------------------------
     Gallery
     ---------------------------------------------------------------------- */

  function makeTag(text, accent) {
    var span = document.createElement('span');
    span.className = accent ? 'tag tag-accent' : 'tag';
    span.textContent = text;
    return span;
  }

  function buildCard(outfit, position) {
    var card = document.createElement('button');
    card.type = 'button';
    card.className = 'card';
    card.dataset.position = String(position);
    card.setAttribute('aria-label', 'Open outfit ' + outfit.id +
      (outfit.title ? ': ' + outfit.title : ''));

    var img = document.createElement('img');
    img.className = 'card-image';
    img.src = outfit.image;
    img.alt = outfit.title || ('Outfit ' + outfit.id);
    img.loading = 'lazy';
    img.decoding = 'async';
    /* Reserve roughly the right space so the masonry columns don't jump while
       lazy images arrive; released once the real ratio is known. */
    img.style.aspectRatio = '2 / 3';
    img.addEventListener('load', function () { img.style.aspectRatio = ''; }, { once: true });
    card.appendChild(img);

    var body = document.createElement('div');
    body.className = 'card-body';

    var head = document.createElement('div');
    head.className = 'card-head';

    var title = document.createElement('h2');
    title.className = 'card-title';
    title.textContent = outfit.title || ('Outfit ' + outfit.id);
    head.appendChild(title);

    if (outfit.id !== undefined) {
      var id = document.createElement('span');
      id.className = 'card-id';
      id.textContent = '#' + outfit.id;
      head.appendChild(id);
    }

    body.appendChild(head);

    var seasons = Array.isArray(outfit.season) ? outfit.season : [];
    var styles = Array.isArray(outfit.style) ? outfit.style : [];

    if (seasons.length || styles.length) {
      var tags = document.createElement('div');
      tags.className = 'tags';
      seasons.forEach(function (season) { tags.appendChild(makeTag(season, false)); });
      styles.forEach(function (style) { tags.appendChild(makeTag(style, true)); });
      body.appendChild(tags);
    }

    card.appendChild(body);
    return card;
  }

  function render(list) {
    visible = list;

    var fragment = document.createDocumentFragment();
    list.forEach(function (outfit, position) {
      fragment.appendChild(buildCard(outfit, position));
    });

    els.gallery.textContent = '';
    els.gallery.appendChild(fragment);

    els.empty.hidden = list.length > 0;

    var total = outfits.length;
    els.count.textContent = list.length === total
      ? total + (total === 1 ? ' outfit' : ' outfits')
      : list.length + ' of ' + total;
  }

  /* ------------------------------------------------------------------------
     Lightbox
     ---------------------------------------------------------------------- */

  function describe(value) {
    if (Array.isArray(value)) {
      return value.filter(function (v) { return v !== null && v !== ''; }).join(', ');
    }
    if (value && typeof value === 'object') {
      return Object.keys(value)
        .map(function (key) { return value[key]; })
        .filter(function (v) { return v !== null && v !== undefined && v !== ''; })
        .join(' · ');
    }
    return String(value);
  }

  function detailKeys(outfit) {
    var keys = Object.keys(outfit).filter(function (key) {
      return key !== 'image' && key !== 'id' && key !== 'title' && key.charAt(0) !== '_';
    });

    return keys.sort(function (a, b) {
      var ia = FIELD_ORDER.indexOf(a);
      var ib = FIELD_ORDER.indexOf(b);
      if (ia === -1 && ib === -1) return keys.indexOf(a) - keys.indexOf(b);
      if (ia === -1) return 1;
      if (ib === -1) return -1;
      return ia - ib;
    });
  }

  function fillDetails(outfit) {
    els.lbTitle.textContent = (outfit.title || 'Outfit') +
      (outfit.id !== undefined ? ' · #' + outfit.id : '');

    els.lbList.textContent = '';

    detailKeys(outfit).forEach(function (key) {
      var text = describe(outfit[key]);
      if (!text) return;

      var row = document.createElement('div');
      row.className = 'lb-row';

      var dt = document.createElement('dt');
      dt.textContent = prettyLabel(key);

      var dd = document.createElement('dd');
      dd.textContent = text;

      row.appendChild(dt);
      row.appendChild(dd);
      els.lbList.appendChild(row);
    });
  }

  function showAt(position) {
    if (position < 0 || position >= visible.length) return;

    lightboxIndex = position;
    var outfit = visible[position];

    els.lbImage.src = outfit.image;
    els.lbImage.alt = outfit.title || ('Outfit ' + outfit.id);
    fillDetails(outfit);

    els.lbPrev.hidden = visible.length < 2;
    els.lbNext.hidden = visible.length < 2;
    els.lbDetails.scrollTop = 0;
  }

  function openLightbox(position) {
    lastFocused = document.activeElement;
    els.lightbox.hidden = false;
    els.lightbox.setAttribute('aria-hidden', 'false');
    document.body.classList.add('lb-open');
    showAt(position);
    els.lbClose.focus();
  }

  function closeLightbox() {
    if (els.lightbox.hidden) return;

    els.lightbox.hidden = true;
    els.lightbox.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('lb-open');
    els.lbImage.src = '';
    lightboxIndex = -1;

    if (lastFocused && document.contains(lastFocused)) {
      lastFocused.focus();
    }
    lastFocused = null;
  }

  function step(delta) {
    if (visible.length < 2) return;
    var next = (lightboxIndex + delta + visible.length) % visible.length;
    showAt(next);
  }

  /* Keep Tab inside the dialog while it's open. */
  function trapFocus(event) {
    var focusable = [els.lbClose, els.lbPrev, els.lbNext].filter(function (el) {
      return !el.hidden;
    });
    if (focusable.length === 0) return;

    var first = focusable[0];
    var last = focusable[focusable.length - 1];

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    } else if (focusable.indexOf(document.activeElement) === -1) {
      event.preventDefault();
      first.focus();
    }
  }

  /* ------------------------------------------------------------------------
     Events
     ---------------------------------------------------------------------- */

  function applySearch() {
    var query = els.search.value;
    els.clear.hidden = query.length === 0;
    render(filter(query));
  }

  els.search.addEventListener('input', applySearch);

  els.clear.addEventListener('click', function () {
    els.search.value = '';
    applySearch();
    els.search.focus();
  });

  els.gallery.addEventListener('click', function (event) {
    var card = event.target.closest('.card');
    if (card) openLightbox(Number(card.dataset.position));
  });

  els.lbClose.addEventListener('click', closeLightbox);
  els.lbPrev.addEventListener('click', function () { step(-1); });
  els.lbNext.addEventListener('click', function () { step(1); });

  /* Clicking the backdrop — anywhere outside the panel — closes. */
  els.lightbox.addEventListener('click', function (event) {
    if (!els.lbPanel.contains(event.target)) closeLightbox();
  });

  document.addEventListener('keydown', function (event) {
    if (!els.lightbox.hidden) {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeLightbox();
      } else if (event.key === 'ArrowLeft') {
        step(-1);
      } else if (event.key === 'ArrowRight') {
        step(1);
      } else if (event.key === 'Tab') {
        trapFocus(event);
      }
      return;
    }

    /* "/" jumps to the search box, as on most gallery sites. */
    if (event.key === '/' && document.activeElement !== els.search) {
      event.preventDefault();
      els.search.focus();
      els.search.select();
    } else if (event.key === 'Escape' && document.activeElement === els.search && els.search.value) {
      els.search.value = '';
      applySearch();
    }
  });

  /* ------------------------------------------------------------------------
     Boot
     ---------------------------------------------------------------------- */

  function fail(message) {
    els.status.textContent = message;
    els.status.hidden = false;
  }

  fetch(DATA_URL, { cache: 'no-cache' })
    .then(function (response) {
      if (!response.ok) throw new Error('HTTP ' + response.status);
      return response.json();
    })
    .then(function (data) {
      if (!Array.isArray(data)) throw new Error('data.json must contain an array');

      outfits = data.map(function (outfit) {
        outfit._index = buildIndex(outfit);
        return outfit;
      });

      els.status.hidden = true;
      applySearch();
    })
    .catch(function (error) {
      fail('Could not load data.json (' + error.message + '). ' +
           'If you opened index.html straight from disk, run a local server ' +
           'instead — for example: python3 -m http.server');
    });
})();
