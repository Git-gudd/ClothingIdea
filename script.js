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

  /* Edits made in the browser live here until they're exported. GitHub Pages
     serves files, it can't write them, so "saving" means keeping the change in
     localStorage and letting you download a fresh data.json to commit. */
  var STORE_KEY = 'outfitLibrary.edits.v1';

  var outfits = [];      // raw records, each with a private _search index
  var visible = [];      // currently filtered records, in gallery order
  var lightboxIndex = -1;
  var lastFocused = null;
  var editing = false;

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
    lbNext: document.getElementById('lb-next'),
    lbEdit: document.getElementById('lb-edit'),
    lbForm: document.getElementById('lb-form'),
    editsBar: document.getElementById('edits-bar'),
    editsText: document.getElementById('edits-text'),
    exportBtn: document.getElementById('export-btn'),
    discardBtn: document.getElementById('discard-btn')
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
    if (editing) closeEditor();

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
    if (editing || visible.length < 2) return;
    var next = (lightboxIndex + delta + visible.length) % visible.length;
    showAt(next);
  }

  /* Keep Tab inside the dialog while it's open. Queried live so the edit
     form's inputs join the cycle while it is open. */
  function trapFocus(event) {
    var candidates = [els.lbClose, els.lbPrev, els.lbNext].concat(
      Array.prototype.slice.call(
        els.lightbox.querySelectorAll('input, select, textarea, button, [href]')
      )
    );

    var seen = [];
    var focusable = candidates.filter(function (el) {
      if (!el || el.hidden || el.disabled || seen.indexOf(el) !== -1) return false;
      if (el.closest('[hidden]')) return false;
      seen.push(el);
      return true;
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
     Editing

     The form is generated from whatever the record actually contains, so a
     field you invent in data.json gets an input automatically. Types are
     preserved on save: arrays stay arrays, groups stay nested objects.
     ---------------------------------------------------------------------- */

  /* A copy without the internal _index, ready to serialise. */
  function plain(outfit) {
    var copy = {};
    Object.keys(outfit).forEach(function (key) {
      if (key.charAt(0) !== '_') copy[key] = outfit[key];
    });
    return copy;
  }

  function readStore() {
    try {
      return JSON.parse(localStorage.getItem(STORE_KEY)) || {};
    } catch (error) {
      return {};
    }
  }

  function writeStore(store) {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(store));
      return true;
    } catch (error) {
      window.alert('Could not save locally: ' + error.message +
        '\n\nDownload data.json now so the change is not lost.');
      return false;
    }
  }

  function refreshEditsBar() {
    var count = Object.keys(readStore()).length;
    els.editsBar.hidden = count === 0;
    els.editsText.textContent = count === 1
      ? '1 outfit edited in this browser'
      : count + ' outfits edited in this browser';
  }

  function makeField(labelText, value, hint) {
    var wrap = document.createElement('div');
    wrap.className = 'field';

    var id = 'f_' + Math.random().toString(36).slice(2, 9);

    var label = document.createElement('label');
    label.textContent = labelText;
    label.htmlFor = id;
    wrap.appendChild(label);

    var multiline = String(value).length > 60;
    var input = document.createElement(multiline ? 'textarea' : 'input');
    if (!multiline) input.type = 'text';
    input.id = id;
    input.value = value;
    wrap.appendChild(input);

    if (hint) {
      var note = document.createElement('span');
      note.className = 'hint';
      note.textContent = hint;
      wrap.appendChild(note);
    }

    return { wrap: wrap, input: input };
  }

  /* Builds the form and returns a reader that turns it back into a record. */
  function buildForm(outfit) {
    els.lbForm.textContent = '';
    var readers = [];

    var keys = ['title'].concat(detailKeys(outfit));

    keys.forEach(function (key) {
      var value = outfit[key];
      if (value === undefined) return;

      if (Array.isArray(value)) {
        var listField = makeField(prettyLabel(key), value.join(', '), 'Separate with commas');
        els.lbForm.appendChild(listField.wrap);
        readers.push(function (target) {
          target[key] = listField.input.value
            .split(',')
            .map(function (part) { return part.trim(); })
            .filter(Boolean);
        });
        return;
      }

      if (value && typeof value === 'object') {
        var group = document.createElement('fieldset');
        group.className = 'group';

        var legend = document.createElement('legend');
        legend.textContent = prettyLabel(key);
        group.appendChild(legend);

        var subReaders = [];
        Object.keys(value).forEach(function (subKey) {
          var subField = makeField(prettyLabel(subKey), value[subKey]);
          group.appendChild(subField.wrap);
          subReaders.push(function (target) {
            var text = subField.input.value.trim();
            if (text) target[subKey] = text;
          });
        });

        els.lbForm.appendChild(group);
        readers.push(function (target) {
          var nested = {};
          subReaders.forEach(function (read) { read(nested); });
          if (Object.keys(nested).length) target[key] = nested;
          else delete target[key];
        });
        return;
      }

      var field = makeField(prettyLabel(key), value === null ? '' : value);
      els.lbForm.appendChild(field.wrap);
      readers.push(function (target) { target[key] = field.input.value.trim(); });
    });

    /* Adding an attribute keeps the schema open-ended without editing code. */
    var adder = document.createElement('div');
    adder.className = 'add-field';

    var nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.placeholder = 'New attribute, e.g. fabric';

    var typeSelect = document.createElement('select');
    [['text', 'Text'], ['list', 'List'], ['group', 'Group']].forEach(function (option) {
      var opt = document.createElement('option');
      opt.value = option[0];
      opt.textContent = option[1];
      typeSelect.appendChild(opt);
    });

    var addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'btn btn-quiet';
    addBtn.textContent = 'Add';

    addBtn.addEventListener('click', function () {
      var name = nameInput.value.trim().replace(/\s+/g, '_').toLowerCase();
      if (!name) return;
      if (Object.prototype.hasOwnProperty.call(outfit, name)) {
        window.alert('"' + name + '" already exists on this outfit.');
        return;
      }

      var kind = typeSelect.value;
      outfit[name] = kind === 'list' ? [] : kind === 'group' ? { type: '' } : '';
      openEditor(outfit);   // rebuild so the new field appears
    });

    adder.appendChild(nameInput);
    adder.appendChild(typeSelect);
    adder.appendChild(addBtn);
    els.lbForm.appendChild(adder);

    var actions = document.createElement('div');
    actions.className = 'form-actions';

    var save = document.createElement('button');
    save.type = 'submit';
    save.className = 'btn btn-primary';
    save.textContent = 'Save';

    var cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'btn btn-quiet';
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', closeEditor);

    actions.appendChild(save);
    actions.appendChild(cancel);
    els.lbForm.appendChild(actions);

    return function readForm() {
      var target = plain(outfit);
      readers.forEach(function (read) { read(target); });
      return target;
    };
  }

  var currentReader = null;

  function openEditor(outfit) {
    editing = true;
    currentReader = buildForm(outfit);
    els.lbList.hidden = true;
    els.lbForm.hidden = false;
    els.lbEdit.textContent = 'Editing';
    els.lbEdit.disabled = true;
    /* Navigating away mid-edit would silently drop what's been typed. */
    els.lbPrev.disabled = true;
    els.lbNext.disabled = true;
    els.lbDetails.scrollTop = 0;
  }

  function closeEditor() {
    editing = false;
    currentReader = null;
    els.lbForm.hidden = true;
    els.lbForm.textContent = '';
    els.lbList.hidden = false;
    els.lbEdit.textContent = 'Edit';
    els.lbEdit.disabled = false;
    els.lbPrev.disabled = false;
    els.lbNext.disabled = false;
    if (lightboxIndex >= 0) fillDetails(visible[lightboxIndex]);
  }

  function saveEditor() {
    if (!currentReader || lightboxIndex < 0) return;

    var outfit = visible[lightboxIndex];
    var updated = currentReader();

    /* Replace the record's own keys in place so object identity — and the
       position of the record inside `outfits` — is preserved. */
    Object.keys(outfit).forEach(function (key) {
      if (key.charAt(0) !== '_') delete outfit[key];
    });
    Object.keys(updated).forEach(function (key) { outfit[key] = updated[key]; });
    outfit._index = buildIndex(outfit);

    var store = readStore();
    store[String(outfit.id)] = plain(outfit);
    writeStore(store);
    refreshEditsBar();

    closeEditor();
    applySearch();

    /* The edit may have moved the outfit out of the current filter. */
    var position = visible.indexOf(outfit);
    if (position === -1) closeLightbox();
    else showAt(position);
  }

  function exportData() {
    var payload = JSON.stringify(outfits.map(plain), null, 2) + '\n';
    var url = URL.createObjectURL(new Blob([payload], { type: 'application/json' }));

    var link = document.createElement('a');
    link.href = url;
    link.download = 'data.json';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function discardEdits() {
    if (!window.confirm('Discard every edit made in this browser and reload the published data?')) return;
    try { localStorage.removeItem(STORE_KEY); } catch (error) { /* nothing to do */ }
    window.location.reload();
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

  els.lbEdit.addEventListener('click', function () {
    if (lightboxIndex >= 0) openEditor(visible[lightboxIndex]);
  });

  els.lbForm.addEventListener('submit', function (event) {
    event.preventDefault();
    saveEditor();
  });

  els.exportBtn.addEventListener('click', exportData);
  els.discardBtn.addEventListener('click', discardEdits);

  /* Clicking the backdrop closes. Tested against the backdrop element itself
     rather than "outside the panel", because a control that re-renders the
     panel detaches its own node mid-click, which would otherwise read as a
     click outside and close the dialog. */
  els.lightbox.addEventListener('click', function (event) {
    if (event.target === els.lightbox) closeLightbox();
  });

  document.addEventListener('keydown', function (event) {
    if (!els.lightbox.hidden) {
      if (event.key === 'Escape') {
        event.preventDefault();
        /* Back out of the form first, so Escape never discards a half-typed
           edit along with the whole dialog. */
        if (editing) closeEditor();
        else closeLightbox();
      } else if (event.key === 'Tab') {
        trapFocus(event);
      } else if (!editing && event.key === 'ArrowLeft') {
        step(-1);
      } else if (!editing && event.key === 'ArrowRight') {
        step(1);
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

      /* Local edits win over the published file until they're exported and
         committed, so a change survives a refresh. */
      var store = readStore();

      outfits = data.map(function (outfit) {
        var saved = store[String(outfit.id)];
        var record = saved ? saved : outfit;
        record._index = buildIndex(record);
        return record;
      });

      els.status.hidden = true;
      refreshEditsBar();
      applySearch();
    })
    .catch(function (error) {
      fail('Could not load data.json (' + error.message + '). ' +
           'If you opened index.html straight from disk, run a local server ' +
           'instead — for example: python3 -m http.server');
    });
})();
