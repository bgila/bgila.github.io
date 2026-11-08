(function () {
  'use strict';
  var SKIP = '__skip', KEY = 'ballot-buddies-picks', KEY_LOC = 'ballot-buddies-location', CONTEST_KEY = 'ballot-2026-picks';
  var M, G, E, NAMES, logth, logpi, K, C, items, byId = {};
  var picks = {}, loc = { zip: '', nb: -1, pct: -1 };
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } }
  function put(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* the page works without saved state */ } }
  function pct(x) { var v = x * 100; return v > 0 && v < 1 ? '<1%' : v > 99 && v < 100 ? '>99%' : Math.round(v) + '%'; }
  function comma(n) { return Math.round(n).toLocaleString('en-US'); }
  function roundish(n) { if (n < 100) return Math.round(n); var p = Math.pow(10, Math.floor(Math.log10(n)) - 1); return Math.round(n / p) * p; }
  function initials(n) { return n.replace(/"[^"]*"/g, '').split(/\s+/).filter(Boolean).map(function (w) { return w[0]; }).filter(function (c) { return /[A-Z]/.test(c); }).slice(0, 2).join(''); }

  // Precincts the current location could be: a tapped block, or everything in the ZIP and neighborhood.
  function placePrecincts() {
    if (loc.pct >= 0) return [loc.pct];
    var base = loc.zip && G.zips[loc.zip] ? G.zips[loc.zip] : null;
    if (!base && loc.nb < 0) return [];
    var list = base || G.pcts.map(function (p, i) { return i; });
    return loc.nb >= 0 ? list.filter(function (i) { return G.pcts[i].nb === loc.nb; }) : list;
  }
  var ownDist = {};
  function refreshOwn() {
    ownDist = {};
    placePrecincts().forEach(function (i) { G.pcts[i].dist.forEach(function (x) { ownDist[x] = true; }); });
  }
  function hasPlace() { return loc.pct >= 0 || loc.nb >= 0 || !!loc.zip; }
  function own(it) { return !it.district || !!ownDist[it.i]; }
  function active(it) { return own(it); }
  function activeItems() { return items.filter(active); }
  function corePicks() { return items.filter(function (it) { return own(it) && !it.uncontested && !extraState(it); }); }
  function extraState(it) { return it.section === 'State' && it.id !== 'california-governor' && it.id !== 'california-insurance-commissioner'; }
  function hidden(it) { return extraState(it) || it.uncontested || (!viewing() && (!own(it) || (!hasPlace() && it.district))); }

  // Flat category indexes a set of picks observes for one race.
  function obsFor(it) {
    var p = picks[it.id];
    if (!p || !p.length) return [];
    if (p[0] === SKIP) return it.multi ? it.choices.map(function (c) { return c.c - 1; }) : [it.skip];
    var out = [];
    if (it.multi) {
      it.choices.forEach(function (c) {
        if (p.indexOf(c.name) >= 0) out.push(c.c);
        else if (p.length >= it.seats) out.push(c.c - 1);
      });
    } else {
      it.choices.forEach(function (c) { if (c.name === p[0]) out.push(c.c); });
    }
    return out;
  }
  function logLik(list, votesOnly) {
    var l = new Float64Array(K);
    for (var k = 0; k < K; k++) l[k] = logpi[k];
    (list || items).forEach(function (it) {
      if (votesOnly && (picks[it.id] || [])[0] === SKIP) return;
      obsFor(it).forEach(function (c) { for (var k = 0; k < K; k++) l[k] += logth[k * C + c]; });
    });
    return l;
  }
  function posterior(l, without) {
    var a = new Float64Array(K), k, m = -Infinity, s = 0;
    for (k = 0; k < K; k++) a[k] = l[k];
    if (without) obsFor(without).forEach(function (c) { for (var j = 0; j < K; j++) a[j] -= logth[j * C + c]; });
    for (k = 0; k < K; k++) if (a[k] > m) m = a[k];
    for (k = 0; k < K; k++) { a[k] = Math.exp(a[k] - m); s += a[k]; }
    for (k = 0; k < K; k++) a[k] /= s;
    return a;
  }
  function logJoint(l) {
    var m = -Infinity, s = 0, k;
    for (k = 0; k < K; k++) if (l[k] > m) m = l[k];
    for (k = 0; k < K; k++) s += Math.exp(l[k] - m);
    return m + Math.log(s);
  }
  function rate(q, c) {
    var s = 0;
    for (var k = 0; k < K; k++) s += q[k] * M.th[k][c] / 10000;
    return s;
  }
  function prediction(it, q) {
    var r = it.choices.map(function (c) { return rate(q, c.c); });
    if (it.multi) return r;
    var t = r.reduce(function (a, b) { return a + b; }, 0) || 1;
    return r.map(function (x) { return x / t; });
  }
  function cityRate(it, c) {
    if (it.multi) { var yes = M.city[c.c], no = M.city[c.c - 1]; return yes / Math.max(yes + no, 1); }
    var t = it.choices.reduce(function (a, x) { return a + M.city[x.c]; }, 0);
    return M.city[c.c] / Math.max(t, 1);
  }
  function nbRate(nb, it, c) {
    if (it.multi) { var yes = nb.c[c.c], no = nb.c[c.c - 1]; return yes / Math.max(yes + no, 1); }
    var t = it.choices.reduce(function (a, x) { return a + nb.c[x.c]; }, 0);
    return nb.c[c.c] / Math.max(t, 1);
  }
  function pickedChoices(it) {
    var p = picks[it.id] || [];
    return it.choices.filter(function (c) { return p.indexOf(c.name) >= 0; });
  }
  // Blocs ignore skipped races. Predictions, Buddies and rarity still use them.
  function blocPosterior() { return posterior(logLik(items, true)); }
  function votedCount() { return items.filter(function (it) { return pickedChoices(it).length > 0; }).length; }
  function answered(it) { return (picks[it.id] || []).length > 0; }

  var SEE = { 'Federal': 'See more federal races', 'State': 'See more state races', 'San Francisco': 'See more city races', 'Board of Supervisors': 'See more supervisor races' };
  var openSections = {};
  // Full names for measures wherever a race is named outside its own card.
  function raceLabel(it) { return it.title ? it.name + ' (' + it.title + ')' : it.name; }
  function infoHTML(it) {
    if (!it.title) return '';
    var body = (it.summary ? '<p class="info-sum">' + esc(it.summary) + '</p>' : '') + (it.pro || '') + (it.con || '') + (it.url ? '<p><a href="' + esc(it.url) + '" target="_blank" rel="noopener">More on Sway</a></p>' : '');
    return '<span class="info-wrap"><button class="info" type="button" aria-label="About ' + esc(it.name) + '" aria-expanded="false">i</button><span class="info-pop" role="tooltip">' + body + '</span></span>';
  }
  function itemHTML(it) {
    var bits = [];
    if (!viewing() && hasPlace() && it.district && !own(it)) bits.push('Not on your ballot');
    if (it.rcv) bits.push('First choice');
    else if (it.multi) bits.push('Pick up to ' + it.seats);
    if (it.uncontested) bits.push('Uncontested');
    var more = it.title ? '' : '<a class="race-link" href="' + esc(it.url) + '" target="_blank" rel="noopener">More on Sway</a>';
    var html = '<article class="item" id="it-' + it.i + '" data-i="' + it.i + '"><div class="item-head"><h3 class="item-name">' + esc(it.name) + (it.title ? ': ' + esc(it.title) : '') + infoHTML(it) + '</h3><span class="item-meta">' + bits.join(' · ') + '</span></div><div class="choices">';
    it.choices.forEach(function (c, j) {
      var yn = c.name === 'Yes' || c.name === 'No';
      var av = yn ? '' : '<span class="avatar">' + (c.img ? '<img loading="lazy" src="../ballot-2026/img/' + esc(c.img) + '.jpg" alt="">' : esc(initials(c.name))) + '</span>';
      html += '<button class="choice' + (yn ? ' yn' : '') + '" data-j="' + j + '">' + av + '<span class="c-body"><span class="c-name">' + esc(c.name) + '</span><span class="c-nums"><span class="n-sf"></span><span class="n-you"></span></span><span class="c-bar"><i></i><u></u></span></span></button>';
    });
    return html + '</div><div class="item-foot"><p class="say"></p><span class="foot-actions">' + more + '<button class="skip" type="button" aria-pressed="false">Skip</button></span></div></article>';
  }
  function renderBallot() {
    refreshOwn();
    var html = '<p class="key">Bar: ' + (placeNb >= 0 ? 'voters here' : groupBloc >= 0 ? 'this group' : 'people like you') + '. Tick: all of San Francisco, or that district\'s voters in a district race.</p>';
    if (!hasPlace() && !viewing()) html += '<p class="notice">Enter your ZIP above to bring up your congressional, assembly and supervisor races.</p>';
    var sections = [];
    items.forEach(function (it) { if (sections.indexOf(it.section) < 0) sections.push(it.section); });
    sections.forEach(function (s) {
      var inS = items.filter(function (it) { return it.section === s && shownInView(it); });
      if (!inS.length) return;
      var main = inS.filter(function (it) { return !hidden(it); });
      var more = inS.filter(hidden).sort(function (a, b) { return (own(a) ? 0 : 1) - (own(b) ? 0 : 1) || (a.uncontested ? 1 : 0) - (b.uncontested ? 1 : 0); });
      html += '<h2>' + esc(s) + '</h2>' + main.map(itemHTML).join('');
      if (more.length) {
        html += '<details class="more" data-s="' + esc(s) + '"' + (openSections[s] ? ' open' : '') + '><summary><span class="chev" aria-hidden="true"></span><span>' + esc(SEE[s] || 'See more') + '</span><span class="more-n" data-more="' + esc(s) + '"></span></summary>' + more.map(itemHTML).join('') + '</details>';
      }
    });
    $('ballot').innerHTML = html;
  }

  // Read-only view of how one bloc voted. Start over is the only way back.
  var groupBloc = -1, placeNb = -1, MIN_PLACE_VOTES = 20;
  function viewing() { return groupBloc >= 0 || placeNb >= 0; }
  function anyPicks() { return items.some(answered); }
  function blocName(i) { return NAMES[i + 1] || 'Bloc ' + (i + 1); }
  function paintGroupBar() {
    var locked = viewing();
    $('group-hint').hidden = !locked;
    $('group-btns').innerHTML = M.blocs.map(function (b) {
      return '<button class="group-btn' + (b.id === groupBloc ? ' on' : '') + '" data-b="' + b.id + '" aria-pressed="' + (b.id === groupBloc) + '">' + esc(blocName(b.id)) + '</button>';
    }).join('');
    $('zip').disabled = locked; $('nb-pick').disabled = locked;
    document.body.classList.toggle('group-mode', locked);
    $('prefill').hidden = locked || sharedView || !get(CONTEST_KEY);
    ['unique', 'axes', 'nb-match', 'endorsers'].forEach(function (id) { $(id).closest('section').hidden = locked; });
  }
  function viewRate(it, c) {
    return groupBloc >= 0 ? c.b[groupBloc] : nbRate(G.nbhoods[placeNb], it, c) * 100;
  }
  function placeVotes(it) {
    var nb = G.nbhoods[placeNb];
    if (it.multi) return nb.c[it.choices[0].c] + nb.c[it.choices[0].c - 1];
    return it.choices.reduce(function (a, x) { return a + nb.c[x.c]; }, 0);
  }
  // A place view only shows races its voters actually had.
  function shownInView(it) { return placeNb < 0 || placeVotes(it) >= MIN_PLACE_VOTES; }
  // Most distinctive citywide picks, from votes cast, so these match the race cards.
  function highlights(rateOf) {
    var rows = [];
    items.forEach(function (it) {
      if (it.district || it.uncontested) return;
      var best = null;
      it.choices.forEach(function (c) {
        var city = cityRate(it, c) * 100, gap = rateOf(it, c) - city;
        if (!best || gap > best.gap) best = { it: it, c: c, gap: gap, city: city };
      });
      rows.push(best);
    });
    return rows.sort(function (x, y) { return y.gap - x.gap; }).slice(0, 4).map(function (r) {
      return '<li>' + esc(raceLabel(r.it)) + ': ' + esc(r.c.name) + ' <b>' + Math.round(rateOf(r.it, r.c)) + '%</b> vs ' + Math.round(r.city) + '% of SF</li>';
    }).join('');
  }
  function blocHighlights(g) { return highlights(function (it, c) { return c.b[g]; }); }
  function paintView() {
    var isPlace = placeNb >= 0, nb = isPlace ? G.nbhoods[placeNb] : null, name = isPlace ? nb.name : blocName(groupBloc);
    var shortLabel = isPlace ? 'Here' : 'Group', who = isPlace ? 'voters in ' + name : name;
    items.forEach(function (it) {
      var el = $('it-' + it.i); if (!el) return;
      el.classList.remove('done');
      var rates = it.choices.map(function (c) { return viewRate(it, c); });
      var order = it.choices.map(function (c, i) { return i; }).sort(function (x, y) { return rates[y] - rates[x]; });
      var tops = order.slice(0, it.multi ? it.seats : 1), btns = el.querySelectorAll('.choice');
      it.choices.forEach(function (c, i) {
        var btn = btns[i], city = cityRate(it, c);
        btn.classList.toggle('on', tops.indexOf(i) >= 0);
        btn.setAttribute('aria-pressed', 'false'); btn.setAttribute('aria-disabled', 'true');
        btn.querySelector('.n-sf').textContent = (it.scope || 'SF') + ' ' + pct(city);
        btn.querySelector('.n-you').innerHTML = shortLabel + ' <b>' + Math.round(rates[i]) + '%</b>';
        btn.querySelector('.c-bar i').style.width = rates[i].toFixed(1) + '%';
        var u = btn.querySelector('.c-bar u');
        u.style.left = 'calc(' + (city * 100).toFixed(1) + '% - 1px)'; u.style.display = '';
      });
      var top = it.choices[order[0]], where = it.scope ? it.scope + ' voters' : 'SF';
      el.querySelector('.say').textContent = it.multi
        ? 'Most marked by ' + who + ': ' + tops.map(function (i) { return it.choices[i].name; }).join(', ') + '.'
        : Math.round(rates[order[0]]) + '% of ' + who + ' picked ' + top.name + ', vs ' + pct(cityRate(it, top)) + ' of ' + where + '.';
    });
    Array.prototype.forEach.call(document.querySelectorAll('.more-n'), function (el) {
      var n = items.filter(function (it) { return it.section === el.getAttribute('data-more') && hidden(it) && shownInView(it); }).length;
      el.textContent = n + (n === 1 ? ' race' : ' races');
    });
    $('share-row').hidden = true;
    if (isPlace) {
      $('bloc-title').textContent = 'How voters here voted';
      $('bloc').innerHTML = '<p class="bloc-name">' + esc(name) + '</p><p class="mini">' + comma(nb.ballots) + ' ballots counted, including Election Day.</p><ul class="tags">' + highlights(viewRate) + '</ul>';
      buddyShare = null;
      pathEls.forEach(function (el, i) { if (el) el.setAttribute('class', G.pcts[i].nb === placeNb ? 'q5' : ''); });
      $('map-title').textContent = name;
      $('map-note').textContent = 'Click another area to see how voters there voted.';
      $('top-nb').innerHTML = '';
      $('peek-text').textContent = name + ' · ' + comma(nb.ballots) + ' ballots';
      return;
    }
    var b = M.blocs[groupBloc], q = new Float64Array(K), tot = 0, k;
    $('bloc-title').textContent = 'How this group voted';
    $('bloc').innerHTML = '<p class="bloc-name">' + esc(name) + '</p><p class="mini">' + pct(b.share) + ' of matched SF ballots.</p><ul class="tags">' + highlights(viewRate) + '</ul><p class="p-note"><b>Closest endorsers:</b> ' + esc(b.end.join(', ')) + '</p>';
    for (k = 0; k < K; k++) if (M.f2b[k] === groupBloc) tot += M.nk[k];
    for (k = 0; k < K; k++) q[k] = M.f2b[k] === groupBloc ? M.nk[k] / tot : 0;
    paintMap(q, 3);
    $('map-title').textContent = 'Where this group lives';
    $('map-note').textContent = 'Darker areas have a larger share of this group. Click the map to see how voters there voted.';
    $('peek-text').textContent = name + ' · ' + pct(b.share) + ' of ballots';
  }
  function chooseBloc(b) {
    groupBloc = b; placeNb = -1;
    paintGroupBar(); renderBallot(); paint();
  }
  function choosePlace(nb) {
    if (nb < 0) return;
    placeNb = nb; groupBloc = -1;
    paintGroupBar(); renderBallot(); paint();
    closeSheet();
  }
  function exitGroup() {
    groupBloc = -1; placeNb = -1;
    $('bloc-title').textContent = 'Your bloc';
    $('map-title').textContent = 'Where your Buddies live';
    paintGroupBar();
  }

  function paint() {
    if (viewing()) { paintView(); return; }
    placeHint();
    var act = activeItems();
    var l = logLik(), q = posterior(l);
    var nPicked = items.filter(answered).length;
    items.forEach(function (it) {
      var el = $('it-' + it.i); if (!el) return;
      var has = answered(it);
      var qq = has ? posterior(l, it) : q;
      var pred = prediction(it, qq);
      var evidence = nPicked - (has ? 1 : 0);
      var skipped = (picks[it.id] || [])[0] === SKIP;
      el.classList.toggle('done', has);
      var sb = el.querySelector('.skip');
      sb.classList.toggle('on', skipped); sb.setAttribute('aria-pressed', skipped ? 'true' : 'false');
      var btns = el.querySelectorAll('.choice');
      it.choices.forEach(function (c, j) {
        var b = btns[j], on = (picks[it.id] || []).indexOf(c.name) >= 0, city = cityRate(it, c);
        b.classList.toggle('on', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
        b.querySelector('.n-sf').textContent = (it.scope || 'SF') + ' ' + pct(city);
        b.querySelector('.n-you').innerHTML = evidence > 0 ? 'Like you <b>' + pct(pred[j]) + '</b>' : '';
        var v = evidence > 0 ? pred[j] : city;
        b.querySelector('.c-bar i').style.width = (v * 100).toFixed(1) + '%';
        var u = b.querySelector('.c-bar u');
        u.style.left = 'calc(' + (city * 100).toFixed(1) + '% - 1px)';
        u.style.display = evidence > 0 ? '' : 'none';
      });
      var say = el.querySelector('.say'), text = '';
      if (skipped) {
        if (it.multi) text = 'You skipped this race.';
        else {
          var cityTotal = it.choices.reduce(function (a, x) { return a + M.city[x.c]; }, 0) + M.city[it.skip] + M.city[it.skip - 1];
          text = pct(M.city[it.skip] / Math.max(cityTotal, 1)) + ' of ' + (it.scope ? it.scope + ' voters' : 'SF') + ' left this blank' + (evidence > 0 ? ', and ' + pct(rate(qq, it.skip)) + ' of people like you.' : '.');
        }
      } else if (has) {
        var ps = pickedChoices(it);
        if (ps.length === 1) {
          var jj = it.choices.indexOf(ps[0]);
          text = pct(cityRate(it, ps[0])) + ' of ' + (it.scope ? it.scope + ' voters' : 'SF') + ' picked ' + ps[0].name + (evidence > 0 ? ', and ' + pct(pred[jj]) + ' of people like you.' : '.');
        } else {
          var lowest = ps.slice().sort(function (a, b) { return cityRate(it, a) - cityRate(it, b); })[0];
          text = 'Your least common pick here: ' + lowest.name + ' (' + pct(cityRate(it, lowest)) + ' of ' + (it.scope ? it.scope + ' voters' : 'SF') + ').';
        }
      } else if (evidence > 0) {
        var order = it.choices.map(function (c, j) { return j; }).sort(function (a, b) { return pred[b] - pred[a]; });
        if (it.multi) text = 'Most popular with people like you: ' + order.slice(0, it.seats).map(function (j) { return it.choices[j].name; }).join(', ') + '.';
        else text = pct(pred[order[0]]) + ' of people like you picked ' + it.choices[order[0]].name + '.';
      }
      say.textContent = text;
    });
    Array.prototype.forEach.call(document.querySelectorAll('.more-n'), function (el) {
      var s = el.getAttribute('data-more'), inMore = items.filter(function (it) { return it.section === s && hidden(it); });
      var n = inMore.filter(answered).length;
      el.textContent = n ? n + ' of ' + inMore.length + ' picked' : inMore.length + (inMore.length === 1 ? ' race' : ' races');
    });
    paintUnique(act);
    paintAxes();
    paintRarity(act, l, q, nPicked);
    paintBloc(blocPosterior(), votedCount());
    paintMap(q, nPicked);
    paintNeighborhoods(act);
    paintEndorsers(act);
    paintPeek(act, l, q, nPicked);
  }

  function jointShare(l) { return Math.exp(logJoint(l)); }
  function matchShares(list) {
    var probs = [];
    list.forEach(function (it) {
      var cs = obsFor(it); if (!cs.length) return;
      var row = new Float64Array(K);
      for (var k = 0; k < K; k++) { var p = 1; cs.forEach(function (c) { p *= M.th[k][c] / 10000; }); row[k] = p; }
      probs.push(row);
    });
    var R = probs.length, exact = 0, w2 = 0, w4 = 0;
    if (!R) return null;
    for (var k = 0; k < K; k++) {
      var D = new Float64Array(R + 1); D[0] = 1;
      for (var r = 0; r < R; r++) {
        var q = probs[r][k];
        for (var dd = r + 1; dd >= 1; dd--) D[dd] = D[dd] * q + D[dd - 1] * (1 - q);
        D[0] *= q;
      }
      var c2 = 0, c4 = 0;
      for (var x = 0; x <= Math.min(4, R); x++) { if (x <= 2) c2 += D[x]; c4 += D[x]; }
      exact += M.pi[k] * D[0]; w2 += M.pi[k] * c2; w4 += M.pi[k] * c4;
    }
    return { exact: exact, within2: w2, within4: w4, races: R };
  }
  function smallPct(x) {
    var v = x * 100;
    if (v >= 10) return Math.round(v) + '%';
    if (v >= 1) return v.toFixed(1) + '%';
    if (v >= 0.01) return v.toFixed(2) + '%';
    return '<0.01%';
  }
  function rareLabel(share) {
    if (share > 0.5) return 'Most voters agree';
    if (1 / share > M.nBallots) return 'Likely one of a kind';
    return 'About 1 in ' + comma(roundish(1 / share));
  }
  function paintRarity(act, l, q, nPicked) {
    var btn = $('next-q'), brk = $('break');
    var ownPicked = act.filter(answered), core = corePicks();
    btn.hidden = !core.some(function (it) { return !answered(it); });
    if (!ownPicked.length) {
      $('rare-stat').textContent = 'Start picking';
      $('rare-note').textContent = 'Every race on your ballot narrows it down. Races you could not vote in shape your bloc and Buddies, not this number.';
      brk.innerHTML = '';
      return;
    }
    var ms = matchShares(act);
    $('rare-stat').innerHTML = '<span class="match-row"><b>' + smallPct(ms.exact) + '</b> had your exact picks</span><span class="match-row"><b>' + smallPct(ms.within2) + '</b> were off by 2 or fewer</span><span class="match-row"><b>' + smallPct(ms.within4) + '</b> were off by 4 or fewer</span>';
    $('rare-note').innerHTML = 'Share of ballots, estimated across the ' + ms.races + ' race' + (ms.races === 1 ? '' : 's') + ' you marked. <a href="../sf-power-index/#you=' + [ms.exact, ms.within2, ms.within4, ms.races].map(function (x) { return +x.toPrecision(4); }).join(',') + '">Compare your reach with SF endorsement guides</a>';
    var rows = ownPicked.map(function (it) {
      var ps = pickedChoices(it);
      if (ps.length !== 1 || it.uncontested) return null;
      var pr = prediction(it, posterior(l, it));
      return { it: it, c: ps[0], you: pr[it.choices.indexOf(ps[0])] };
    }).filter(Boolean).sort(function (a, b) { return a.you - b.you; }).slice(0, 3);
    brk.innerHTML = nPicked >= 3 && rows.length ? '<p class="p-note"><b>Your least typical picks</b></p><ul class="tags">' + rows.map(function (r) {
      return '<li>' + esc(raceLabel(r.it)) + ': ' + esc(r.c.name) + ', ' + pct(r.you) + ' of your Buddies</li>';
    }).join('') + '</ul>' : '';
  }
  // How well the rest of a ballot predicts each vote, ranked against real voters with the same number of votes.
  function predictability(list) {
    var lv = logLik(items, true), sum = 0, hits = 0, n = 0;
    list.forEach(function (it) {
      if (it.multi || it.uncontested) return;
      var ps = pickedChoices(it);
      if (ps.length !== 1) return;
      var pr = prediction(it, posterior(lv, it)), mine = it.choices.indexOf(ps[0]), best = 0;
      pr.forEach(function (x, i) { if (x > pr[best]) best = i; });
      sum += pr[mine]; hits += best === mine ? 1 : 0; n++;
    });
    if (!n) return { n: 0 };
    var score = sum / n, bi = 0, i = 0;
    M.pred.buckets.forEach(function (b, x) { if (Math.abs(b - n) < Math.abs(M.pred.buckets[bi] - n)) bi = x; });
    var q = M.pred.q[bi];
    while (i < 100 && q[i] < score) i++;
    return { n: n, hits: hits, score: score, pct: i };
  }
  var MIN_SCORE_VOTES = 10;
  function partyLineText(pct) {
    return pct >= 50 ? 'More party-line than ' + pct + '% of voters' : 'More iconoclastic than ' + (100 - pct) + '% of voters';
  }
  // Share of a voter's votes on the positive side of an axis, ranked against whole ballots.
  function axisResult(ax) {
    var hit = 0, n = 0;
    ax.races.forEach(function (r) {
      var p = picks[r.id];
      if (!p || !p.length || p[0] === SKIP) return;
      n++; if (p[0] === r.pick) hit++;
    });
    if (n < ax.minVotes) return { n: n, hit: hit, ready: false };
    var score = Math.round(hit / n * 10000) / 10000, below = 0, above = 0, tied = 0;
    ax.table.forEach(function (row) {
      if (row[0] < score - 1e-6) below += row[1];
      else if (row[0] > score + 1e-6) above += row[1];
      else tied += row[1];
    });
    // Nobody can pass a voter on the end of a scale, so a percent "more than" would undersell them.
    var atTop = hit === n, atBottom = hit === 0, more = below >= above;
    return { n: n, hit: hit, ready: true, tied: tied, pos: atTop ? 1 : atBottom ? 0 : below + tied / 2,
      text: atTop ? ax.top : atBottom ? ax.bottom : more ? ax.more + ' than ' + Math.round(below * 100) + '% of voters' : ax.less + ' than ' + Math.round(above * 100) + '% of voters' };
  }
  function raceChip(ax) {
    return ax.races.map(function (r) { var it = byId[r.id]; return it ? '<li>' + esc(raceLabel(it)) + ': ' + esc(r.pick) + '</li>' : ''; }).join('');
  }
  var axisOpen = {};
  function paintAxes() {
    $('axes').innerHTML = M.axes.map(function (ax) {
      var r = axisResult(ax);
      var body = r.ready
        ? '<p class="axis-head">' + esc(r.text) + '</p><div class="scale scale-plain" role="img" aria-label="' + esc(r.text) + '"><i style="left:' + (Math.max(0.02, Math.min(0.98, r.pos)) * 100).toFixed(1) + '%"></i></div><div class="scale-ends"><span>' + esc(ax.ends[0]) + '</span><span>' + esc(ax.ends[1]) + '</span></div><p class="p-note">' + r.hit + ' of your ' + r.n + ' votes here took the ' + esc(ax.ends[1].replace('Most ', '')) + ' side. ' + (r.tied ? Math.round(r.tied * 100) + '% of voters match that.' : '') + '</p>'
        : '<p class="p-note">Vote in ' + (ax.minVotes - r.n) + ' more of these races to see where you land.</p>';
      return '<div class="axis"><h3 class="p-sub-plain">' + esc(ax.title) + '</h3>' + body + '<details class="sub" data-axis="' + ax.id + '"' + (axisOpen[ax.id] ? ' open' : '') + '><summary>What counts</summary><ul>' + raceChip(ax) + '</ul></details></div>';
    }).join('');
  }
  function paintUnique(act) {
    var r = predictability(act), box = $('unique');
    if (r.n < MIN_SCORE_VOTES) {
      box.innerHTML = '<p class="p-note">Vote in ' + (MIN_SCORE_VOTES - r.n) + ' more ' + (MIN_SCORE_VOTES - r.n === 1 ? 'race' : 'races') + ' to see where you land.</p>';
      return;
    }
    var pct = Math.max(1, Math.min(99, r.pct));
    var head = partyLineText(pct);
    box.innerHTML = '<p class="stat stat-sm">' + head + '</p>' +
      '<div class="scale" role="img" aria-label="' + esc(head) + '"><i style="left:' + pct + '%"></i></div>' +
      '<div class="scale-ends"><span>Most iconoclastic</span><span>Most party-line</span></div>' +
      '<p class="p-note">The rest of your ballot predicts ' + r.hits + ' of your ' + r.n + ' votes.</p>';
  }

  function nextQuestion() {
    var l = logLik(), q = posterior(l), best = null, bestG = -1;
    corePicks().forEach(function (it) {
      if (answered(it) || it.multi) return;
      var mean = it.choices.map(function (c) { return rate(q, c.c); }), g = 0;
      for (var j = 0; j < mean.length; j++) {
        var hm = mean[j] > 0 ? -mean[j] * Math.log(mean[j]) : 0, hc = 0;
        for (var k = 0; k < K; k++) { var t = M.th[k][it.choices[j].c] / 10000; if (t > 0) hc += q[k] * -t * Math.log(t); }
        g += hm - hc;
      }
      if (g > bestG) { bestG = g; best = it; }
    });
    if (!best) best = corePicks().filter(function (it) { return !answered(it); })[0];
    if (!best) return;
    var el = $('it-' + best.i);
    var det = el.closest('details');
    if (det) det.open = true;
    closeSheet();
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add('flash');
    setTimeout(function () { el.classList.remove('flash'); }, 1500);
  }

  function paintBloc(q, nPicked) {
    $('share-row').hidden = nPicked < 3;
    if (nPicked < 3) { $('bloc').innerHTML = '<p class="p-note">Pick ' + (3 - nPicked) + ' more to find yours.</p>'; return; }
    var by = M.blocs.map(function () { return 0; });
    for (var k = 0; k < K; k++) by[M.f2b[k]] += q[k];
    var order = by.map(function (v, i) { return i; }).sort(function (a, b) { return by[b] - by[a]; });
    var top = M.blocs[order[0]];
    var html = '<p class="bloc-name">' + esc(NAMES[top.id + 1] || 'Bloc ' + (top.id + 1)) + '</p><p class="mini">' + pct(by[order[0]]) + ' likely, based on your picks. ' + pct(top.share) + ' of ballots.</p>';
    html += '<ul class="tags">' + blocHighlights(top.id) + '</ul>';
    html += '<ol class="rows">' + order.slice(1, 3).map(function (i) {
      return '<li><span>' + esc(NAMES[i + 1] || 'Bloc ' + (i + 1)) + '</span><span class="v">' + pct(by[i]) + '</span><span class="bar"><i style="width:' + (by[i] * 100).toFixed(1) + '%"></i></span></li>';
    }).join('') + '</ol>';
    $('bloc').innerHTML = html;
  }

  var pathEls = [];
  function initMap() {
    var svg = $('map');
    svg.setAttribute('viewBox', '0 0 ' + G.w + ' ' + G.h);
    var html = '';
    G.pcts.forEach(function (p, i) { if (p.path) html += '<path data-i="' + i + '" d="' + p.path + '"></path>'; });
    svg.innerHTML = html;
    Array.prototype.forEach.call(svg.querySelectorAll('path'), function (el) { pathEls[+el.getAttribute('data-i')] = el; });
    svg.addEventListener('click', function (e) {
      var t = e.target.closest('path'); if (!t) return;
      if (viewing() || !anyPicks()) { choosePlace(G.pcts[+t.getAttribute('data-i')].nb); return; }
      var i = +t.getAttribute('data-i'), keep = loc.zip && (G.zips[loc.zip] || []).indexOf(i) >= 0;
      setLocation({ zip: keep ? loc.zip : '', nb: G.pcts[i].nb, pct: i });
    });
    svg.addEventListener('mousemove', function (e) {
      var t = e.target.closest('path'), tip = $('tip');
      if (!t) { tip.hidden = true; return; }
      var i = +t.getAttribute('data-i'), p = G.pcts[i], nb = G.nbhoods[p.nb];
      var txt = '<b>' + esc(nb ? nb.name : 'Precinct ' + p.id) + '</b><br>Precinct ' + esc(p.id);
      if (buddyShare && p.area >= 0 && G.areas[p.area].n) txt += '<br>' + esc(G.areas[p.area].name) + ': ' + (buddyShare[p.area] / avgShare).toFixed(1) + '× the city average';
      tip.innerHTML = txt; tip.hidden = false;
      var r = svg.getBoundingClientRect();
      var x = e.clientX - r.left + 12, y = e.clientY - r.top + 12;
      tip.style.left = Math.min(x, r.width - 190) + 'px'; tip.style.top = Math.min(y, r.height - 60) + 'px';
    });
    svg.addEventListener('mouseleave', function () { $('tip').hidden = true; });
  }
  var buddyShare = null, avgShare = 1;
  function buddyStats(q) {
    var A = G.areas.length, counts = new Float64Array(A), total = 0, k, a;
    for (k = 0; k < K; k++) {
      if (q[k] < 0.001) continue;
      total += q[k] * M.nk[k];
      for (a = 0; a < A; a++) counts[a] += q[k] * G.buddy[k][a];
    }
    var share = new Float64Array(A), vals = [], list = [];
    for (a = 0; a < A; a++) {
      if (!G.areas[a].n) continue;
      share[a] = counts[a] / G.areas[a].n;
      vals.push(share[a]); list.push({ a: a, v: share[a] });
    }
    vals.sort(function (x, y) { return x - y; });
    var cut = [0.2, 0.4, 0.6, 0.8].map(function (f) { return vals[Math.floor(vals.length * f)]; });
    list.sort(function (x, y) { return y.v - x.v; });
    function step(ar) {
      if (ar < 0 || !G.areas[ar].n) return 0;
      var v = share[ar];
      return v < cut[0] ? 1 : v < cut[1] ? 2 : v < cut[2] ? 3 : v < cut[3] ? 4 : 5;
    }
    return { share: share, step: step, total: total, avg: total / Math.max(M.nBallots, 1), top: list.slice(0, 3) };
  }
  function paintMap(q, nPicked) {
    if (nPicked < 3) {
      buddyShare = null;
      pathEls.forEach(function (el) { if (el) el.setAttribute('class', ''); });
      $('map-note').textContent = nPicked ? 'Pick three races and your Buddies will appear across San Francisco.' : 'Click the map to see how voters there voted.';
      $('top-nb').innerHTML = '';
    } else {
      var st = buddyStats(q);
      buddyShare = st.share; avgShare = st.avg;
      pathEls.forEach(function (el, i) {
        if (!el) return;
        var c = st.step(G.pcts[i].area);
        el.setAttribute('class', c ? 'q' + c : '');
      });
      $('map-note').textContent = 'About ' + comma(roundish(st.total)) + ' ballots are your closest Buddies. Darker areas have a larger share of them.';
      var max = st.top[0].v;
      $('top-nb').innerHTML = st.top.map(function (r) {
        return '<li><span>' + esc(G.areas[r.a].name) + '</span><span class="v">' + (r.v / st.avg).toFixed(1) + '× city average</span><span class="bar"><i style="width:' + (r.v / Math.max(max, 1e-9) * 100).toFixed(1) + '%"></i></span></li>';
      }).join('');
    }
    pathEls.forEach(function (el, i) { if (el && i === loc.pct) el.classList.add('sel'); else if (el) el.classList.remove('sel'); });
  }

  function paintNeighborhoods(act) {
    var chosen = items.filter(function (it) { return !it.district && !it.uncontested && pickedChoices(it).length; });
    if (chosen.length < 3) { $('nb-match').innerHTML = '<p class="p-note">Pick ' + (3 - chosen.length) + ' more citywide ' + (chosen.length === 2 ? 'race' : 'races') + '.</p>'; return; }
    var rows = G.nbhoods.map(function (nb, n) {
      if (nb.ballots < 200) return null;
      var s = 0, m = 0, c = 0;
      chosen.forEach(function (it) {
        pickedChoices(it).forEach(function (ch) { var r = nbRate(nb, it, ch); s += Math.log(Math.max(r, 0.001)); m += r; c++; });
      });
      return { name: nb.name, score: s / c, mean: m / c };
    }).filter(Boolean).sort(function (a, b) { return b.score - a.score; });
    var top = rows[0], low = rows[rows.length - 1];
    $('nb-match').innerHTML = '<p class="bloc-name">' + esc(top.name) + '</p><p class="mini">On average, ' + pct(top.mean) + ' of voters there made each of your picks.</p><ol class="rows">' + rows.slice(1, 3).map(function (r) {
      return '<li><span>' + esc(r.name) + '</span><span class="v">' + pct(r.mean) + '</span></li>';
    }).join('') + '<li><span>Least like you: ' + esc(low.name) + '</span><span class="v">' + pct(low.mean) + '</span></li></ol>';
  }

  var splitOpen = false, allOpen = false;
  function endorserLink(e, cls) {
    return '<a' + (cls ? ' class="' + cls + '"' : '') + ' href="' + esc(e.url) + '" target="_blank" rel="noopener">' + esc(e.name) + '</a>';
  }
  function paintEndorsers(act) {
    var rows = E.map(function (e) {
      var s = 0, n = 0, miss = [];
      items.forEach(function (it) {
        if (!answered(it) || picks[it.id][0] === SKIP) return;
        var pos = e.positions[it.id];
        if (pos == null) return;
        var theirs = Array.isArray(pos) ? pos : [pos], mine = picks[it.id], hit = 0;
        mine.forEach(function (x) { if (theirs.indexOf(x) >= 0) hit++; });
        var score = it.multi ? hit / Math.min(mine.length, theirs.length || 1) : hit > 0 ? 1 : 0;
        s += Math.min(score, 1); n++;
        if (score < 1) miss.push(raceLabel(it) + ': you ' + mine.join(', ') + ', they ' + theirs.join(', '));
      });
      return { e: e, n: n, score: n ? s / n : 0, rank: (s + 2) / (n + 4), miss: miss };
    }).filter(function (r) { return r.n >= 5; }).sort(function (a, b) { return b.rank - a.rank; });
    if (!rows.length) { $('endorsers').innerHTML = '<p class="p-note">Pick at least five races that endorsers weighed in on.</p>'; return; }
    var t = rows[0];
    var split = t.miss.length ? '<details class="sub" data-k="split"' + (splitOpen ? ' open' : '') + '><summary>Where you split (' + t.miss.length + ')</summary><ul>' + t.miss.map(function (m) { return '<li>' + esc(m) + '</li>'; }).join('') + '</ul></details>' : '';
    $('endorsers').innerHTML = '<p class="bloc-name">' + endorserLink(t.e) + '</p><p class="mini">You agree on ' + pct(t.score) + ' of ' + t.n + ' shared races.</p>' +
      '<ol class="rows">' + rows.slice(1, 5).map(function (r) {
        return '<li><span>' + endorserLink(r.e) + '</span><span class="v">' + pct(r.score) + '</span><span class="bar"><i style="width:' + (r.score * 100).toFixed(1) + '%"></i></span></li>';
      }).join('') + '</ol>' + split +
      (rows.length > 5 ? '<details class="sub" data-k="all"' + (allOpen ? ' open' : '') + '><summary>All ' + rows.length + ' endorsers</summary><ol class="rows">' + rows.map(function (r) {
        return '<li><span>' + endorserLink(r.e) + ' <span class="src">' + r.n + ' races</span></span><span class="v">' + pct(r.score) + '</span></li>';
      }).join('') + '</ol></details>' : '');
  }

  function paintPeek(act, l, q, nPicked) {
    if (!nPicked) { $('peek-text').textContent = 'Your results'; return; }
    var by = M.blocs.map(function () { return 0; }), bq = blocPosterior();
    for (var k = 0; k < K; k++) by[M.f2b[k]] += bq[k];
    var bi = by.indexOf(Math.max.apply(null, by));
    var share = jointShare(logLik(act));
    var core = corePicks();
    $('peek-text').textContent = core.filter(answered).length + ' of ' + core.length + ' · ' + smallPct(share) + ' exact' + (votedCount() >= 3 ? ' · ' + (NAMES[bi + 1] || 'Bloc ' + (bi + 1)) : '');
  }

  var sharedView = false;
  function savePicks() { if (!sharedView) put(KEY, picks); }
  function setLocation(next) {
    loc = next;
    if (!sharedView) put(KEY_LOC, loc);
    paintPlace();
    var y = window.scrollY;
    renderBallot(); paint();
    window.scrollTo(0, y);
  }
  // Neighborhoods in a ZIP, largest by precinct count.
  function zipNbhoods(zip) {
    var c = {};
    (G.zips[zip] || []).forEach(function (i) { var n = G.pcts[i].nb; if (n >= 0) c[n] = (c[n] || 0) + 1; });
    return Object.keys(c).map(Number).sort(function (a, b) { return c[b] - c[a]; });
  }
  function districtsSpanned() {
    var byType = {};
    Object.keys(ownDist).forEach(function (i) {
      var it = items[+i], t = it.section;
      (byType[t] = byType[t] || []).push(it.scope);
    });
    return Object.keys(byType).filter(function (t) { return byType[t].length > 1; }).map(function (t) { return byType[t].join(' or '); });
  }
  function placeHint() {
    if (loc.pct >= 0 || loc.nb < 0) return;
    var span = districtsSpanned(), picked = anyPicks();
    $('where-hint').textContent = span.length
      ? 'This area spans ' + span.join(', ') + (picked ? '. Tap your block on the map to settle it.' : '. Pick a race, then tap your block on the map to settle it.')
      : picked ? 'Tap your block on the map if this looks off.' : '';
  }
  function paintPlace() {
    refreshOwn();
    $('zip').value = loc.zip || '';
    var sel = $('nb-pick'), res = $('zip-result'), hint = $('where-hint');
    var inZip = loc.zip ? zipNbhoods(loc.zip) : [];
    sel.innerHTML = inZip.map(function (n) { return '<option value="' + n + '">' + esc(G.nbhoods[n].name) + '</option>'; }).join('');
    sel.hidden = inZip.length < 2;
    if (inZip.length && loc.nb >= 0) sel.value = loc.nb;
    if (loc.pct >= 0) {
      var nm = G.nbhoods[loc.nb];
      res.textContent = (nm ? nm.name + ', ' : '') + 'precinct ' + G.pcts[loc.pct].id;
      hint.textContent = 'Your district races are set from this block.';
    } else if (loc.nb >= 0) {
      res.textContent = inZip.length > 1 ? 'Neighborhood:' : G.nbhoods[loc.nb].name;
      placeHint();
    } else {
      res.textContent = ''; hint.textContent = 'Stays in your browser. Sets your neighborhood and district races.';
    }
  }
  function applyZip(raw) {
    var z = String(raw || '').replace(/\D/g, '').slice(0, 5);
    if (z.length < 5) {
      if (z.length === 0 && (loc.zip || loc.nb >= 0 || loc.pct >= 0)) setLocation({ zip: '', nb: -1, pct: -1 });
      return;
    }
    if (!G.zips[z]) {
      $('zip-result').textContent = '';
      $('where-hint').textContent = z + " doesn't look like an SF residential ZIP. Try again or tap your block on the map.";
      return;
    }
    var nbs = zipNbhoods(z);
    setLocation({ zip: z, nb: nbs.length ? nbs[0] : -1, pct: -1 });
  }

  function closeSheet() { $('panel').classList.remove('open'); $('peek').setAttribute('aria-expanded', 'false'); document.body.style.overflow = ''; }

  function bind() {
    function closeInfos(except) {
      Array.prototype.forEach.call(document.querySelectorAll('.info-wrap.open'), function (w) {
        if (w !== except) { w.classList.remove('open'); w.querySelector('.info').setAttribute('aria-expanded', 'false'); }
      });
    }
    document.addEventListener('click', function (e) { if (!e.target.closest('.info-wrap')) closeInfos(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeInfos(); });
    $('ballot').addEventListener('click', function (e) {
      var inf = e.target.closest('.info');
      if (inf) {
        var w = inf.parentNode; closeInfos(w);
        inf.setAttribute('aria-expanded', w.classList.toggle('open') ? 'true' : 'false');
        return;
      }
      if (viewing()) return;
      var sk = e.target.closest('.skip');
      if (sk) {
        var si = items[+sk.closest('.item').getAttribute('data-i')];
        if ((picks[si.id] || [])[0] === SKIP) delete picks[si.id]; else picks[si.id] = [SKIP];
        savePicks(); paint(); return;
      }
      var b = e.target.closest('.choice'); if (!b) return;
      var it = items[+b.closest('.item').getAttribute('data-i')], c = it.choices[+b.getAttribute('data-j')];
      var cur = picks[it.id] || [];
      if (cur[0] === SKIP) cur = [];
      var i = cur.indexOf(c.name);
      if (it.seats > 1) {
        if (i >= 0) cur.splice(i, 1);
        else if (cur.length < it.seats) cur.push(c.name);
        else return;
        if (cur.length) picks[it.id] = cur; else delete picks[it.id];
      } else if (i >= 0) delete picks[it.id];
      else picks[it.id] = [c.name];
      savePicks(); paint();
    });
    $('zip').addEventListener('input', function () { this.value = this.value.replace(/\D/g, '').slice(0, 5); applyZip(this.value); });
    $('nb-pick').addEventListener('change', function () { setLocation({ zip: loc.zip, nb: +this.value, pct: -1 }); });
    $('ballot').addEventListener('toggle', function (e) {
      var d = e.target; if (d && d.tagName === 'DETAILS') openSections[d.getAttribute('data-s')] = d.open;
    }, true);
    $('next-q').addEventListener('click', nextQuestion);
    $('reset').addEventListener('click', function () { exitGroup(); picks = {}; savePicks(); renderBallot(); paint(); });
    $('group-btns').addEventListener('click', function (e) {
      var b = e.target.closest('.group-btn');
      if (b) chooseBloc(+b.getAttribute('data-b'));
    });
    $('share-link').addEventListener('click', copyLink);
    $('share-image').addEventListener('click', copyImage);
    $('own-ballot').addEventListener('click', function () { location.hash = ''; location.reload(); });
    $('axes').addEventListener('toggle', function (e) {
      var k = e.target.getAttribute('data-axis');
      if (k) axisOpen[k] = e.target.open;
    }, true);
    $('endorsers').addEventListener('toggle', function (e) {
      var d = e.target;
      if (d.getAttribute('data-k') === 'split') splitOpen = d.open;
      if (d.getAttribute('data-k') === 'all') allOpen = d.open;
    }, true);
    $('prefill').addEventListener('click', function () {
      var saved = get(CONTEST_KEY) || {};
      items.forEach(function (it) {
        var p = saved[it.id]; if (p == null) return;
        var arr = (Array.isArray(p) ? p : [p]).map(function (n) {
          var m = it.choices.filter(function (c) { return c.name === n || c.aka === n; })[0];
          return m ? m.name : null;
        }).filter(Boolean).slice(0, it.seats);
        if (arr.length) picks[it.id] = arr;
      });
      savePicks(); renderBallot(); paint();
    });
    $('peek').addEventListener('click', function () {
      var open = $('panel').classList.toggle('open');
      this.setAttribute('aria-expanded', open ? 'true' : 'false');
      document.body.style.overflow = open ? 'hidden' : '';
    });
    $('sheet-close').addEventListener('click', closeSheet);
  }

  // Links keep the whole state in the URL fragment, which browsers never send to a server.
  // One character per single-choice race, two per multi-seat race. Precincts stay out of links.
  var B36 = '0123456789abcdefghijklmnopqrstuvwxyz';
  function encodeState() {
    var s = '';
    items.forEach(function (it) {
      var p = picks[it.id] || [];
      if (it.multi) {
        var mask = 0;
        if (p[0] === SKIP) mask = 1295;
        else it.choices.forEach(function (c, i) { if (p.indexOf(c.name) >= 0) mask |= 1 << i; });
        s += B36[Math.floor(mask / 36)] + B36[mask % 36];
      } else {
        var v = 0;
        if (p[0] === SKIP) v = 35;
        else it.choices.forEach(function (c, i) { if (p[0] === c.name) v = i + 1; });
        s += B36[v];
      }
    });
    return '1.' + (loc.zip || '') + '.' + (loc.nb >= 0 ? loc.nb.toString(36) : '') + '.' + s.replace(/0+$/, '');
  }
  function decodeState(hash) {
    var m = /^#1\.(\d{0,5})\.([0-9a-z]*)\.([0-9a-z]*)$/.exec(hash || '');
    if (!m) return null;
    var str = m[3], at = 0, out = {};
    function next() { var ch = str[at++]; return ch ? B36.indexOf(ch) : 0; }
    items.forEach(function (it) {
      if (it.multi) {
        var mask = next() * 36; mask += next();
        if (mask === 1295) out[it.id] = [SKIP];
        else {
          var arr = it.choices.filter(function (c, i) { return mask & (1 << i); }).map(function (c) { return c.name; }).slice(0, it.seats);
          if (arr.length) out[it.id] = arr;
        }
      } else {
        var v = next();
        if (v === 35) out[it.id] = [SKIP];
        else if (v > 0 && it.choices[v - 1]) out[it.id] = [it.choices[v - 1].name];
      }
    });
    var nb = m[2] ? parseInt(m[2], 36) : -1;
    return { picks: out, loc: { zip: G.zips[m[1]] ? m[1] : '', nb: nb < G.nbhoods.length ? nb : -1, pct: -1 } };
  }
  function topGroup(q) {
    var by = M.blocs.map(function () { return 0; }), k;
    for (k = 0; k < K; k++) by[M.f2b[k]] += q[k];
    var b = by.indexOf(Math.max.apply(null, by)), best = -1, bv = -1;
    for (k = 0; k < K; k++) if (M.f2b[k] === b && q[k] > bv) { bv = q[k]; best = k; }
    return { bloc: b, group: best };
  }
  var toastTimer;
  function toast(msg) {
    var t = $('toast');
    t.textContent = msg; t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, 2600);
  }
  function shareURL() {
    var q = blocPosterior(), base = location.href.split('#')[0].replace(/s\/\d+\/?$/, '').replace(/index\.html$/, '');
    return base + 's/' + topGroup(q).group + '/#' + encodeState();
  }
  function copyLink() {
    var url = shareURL();
    function ok() { toast('Link copied. It includes your picks and ZIP.'); }
    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = url; document.body.appendChild(ta); ta.select();
      var done = false;
      try { done = document.execCommand('copy'); } catch (err) { console.error(err); }
      document.body.removeChild(ta);
      if (done) ok(); else toast('Could not copy. Your browser blocked it.');
    }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(ok, fallback);
    else fallback();
  }
  function cardData(q, rarity, blocQ, lines) {
    var tg = topGroup(blocQ || q), st = buddyStats(q), bl = M.blocs[tg.bloc];
    return {
      name: NAMES[bl.id + 1] || 'Bloc ' + (bl.id + 1), share: bl.share, rarity: rarity,
      top: st.top.map(function (r) { return { name: G.areas[r.a].name, x: r.v / st.avg }; }), lines: lines || [],
      w: G.w, h: G.h,
      paths: G.pcts.filter(function (p) { return p.path; }).map(function (p) { return { d: p.path, step: st.step(p.area) }; })
    };
  }
  function drawCurrent() {
    var l = logLik(), own = logLik(activeItems()), share = jointShare(own);
    var canvas = document.createElement('canvas');
    var lines = [], pr = predictability(activeItems());
    if (pr.n >= MIN_SCORE_VOTES) lines.push(partyLineText(Math.max(1, Math.min(99, pr.pct))));
    M.axes.forEach(function (ax) { var r = axisResult(ax); if (r.ready) lines.push(r.text); });
    window.BallotCard.draw(canvas, cardData(posterior(l), activeItems().some(answered) ? 'My exact picks: ' + smallPct(share) + ' of ballots' : null, blocPosterior(), lines));
    return canvas;
  }
  function downloadCard(blob) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'sf-ballot-buddies.png';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
  }
  function copyImage() {
    var pngPromise = window.BallotCard.ready().then(function () {
      return new Promise(function (res, rej) { drawCurrent().toBlob(function (b) { if (b) res(b); else rej(new Error('Image failed')); }, 'image/png'); });
    });
    if (navigator.clipboard && window.ClipboardItem) {
      navigator.clipboard.write([new ClipboardItem({ 'image/png': pngPromise })]).then(function () { toast('Image copied.'); }, function (err) {
        console.error(err);
        pngPromise.then(function (b) { downloadCard(b); toast('Saved the image instead.'); }, function () { toast('Could not make the image.'); });
      });
    } else pngPromise.then(function (b) { downloadCard(b); toast('Saved the image.'); }, function () { toast('Could not make the image.'); });
  }
  // Used by the build step that pre-renders link preview images.
  window.BallotBuddies = {
    scoreFor: function (p) {
      var keep = picks; picks = p;
      var r = predictability(items.filter(function (it) { return (p[it.id] || []).length; }));
      picks = keep;
      return r;
    },
    groupCount: function () { return K; },
    groupBlocName: function (k) { var b = M.f2b[k]; return NAMES[b + 1] || 'Bloc ' + (b + 1); },
    renderGroup: function (k) {
      var q = new Float64Array(K); q[k] = 1;
      var c = document.createElement('canvas');
      window.BallotCard.draw(c, cardData(q, null));
      return c.toDataURL('image/jpeg', 0.82);
    },
    renderGeneric: function () {
      var c = document.createElement('canvas');
      window.BallotCard.draw(c, { name: 'Who votes like you?', share: null, rarity: null, generic: true, top: [], w: G.w, h: G.h, paths: G.pcts.filter(function (p) { return p.path; }).map(function (p) { return { d: p.path, step: 2 }; }) });
      return c.toDataURL('image/jpeg', 0.82);
    }
  };

  function load(p) { return fetch(p).then(function (r) { if (!r.ok) throw new Error(p + ' ' + r.status); return r.json(); }); }
  Promise.all([load('data/model.json'), load('data/geo.json'), load('data/endorsers.json'), load('data/bloc-names.json')]).then(function (a) {
    M = a[0]; G = a[1]; E = a[2]; NAMES = a[3];
    items = M.items; K = M.K; C = M.off[M.off.length - 1];
    items.forEach(function (it, i) { it.i = i; byId[it.id] = it; });
    logth = new Float64Array(K * C);
    for (var k = 0; k < K; k++) for (var c = 0; c < C; c++) logth[k * C + c] = Math.log(M.th[k][c] / 10000);
    logpi = M.pi.map(Math.log);
    picks = get(KEY) || {};
    Object.keys(picks).forEach(function (id) { if (!byId[id]) delete picks[id]; });
    var savedLoc = get(KEY_LOC);
    if (savedLoc && savedLoc.nb < G.nbhoods.length && savedLoc.pct < G.pcts.length) loc = { zip: savedLoc.zip || '', nb: savedLoc.nb, pct: savedLoc.pct };
    var shared = decodeState(location.hash);
    if (shared) {
      sharedView = true; picks = shared.picks; loc = shared.loc;
      $('shared-banner').hidden = false;
    }
    paintPlace();
    if (get(CONTEST_KEY) && !sharedView) $('prefill').hidden = false;
    $('method-counts').textContent = 'Built from ' + comma(M.nMail + M.nQr) + ' whole ballots: ' + comma(M.nMail) + ' mail ballots matched from separate cards, and ' + comma(M.nQr) + ' QR ballots that are complete in the data.';
    renderBallot(); initMap(); bind(); paintGroupBar(); paint();
  }).catch(function (err) {
    console.error(err);
    $('ballot').innerHTML = '<p class="notice">The ballot data did not load. Reload to try again.</p>';
  });
})();
