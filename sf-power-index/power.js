(function () {
  'use strict';
  var D, key = 'within2', you = null, showAll = false, mode = 'common';
  var COLS = ['exact', 'within2', 'within4'];
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function pct(x) {
    var p = x * 100;
    if (p === 0) return '0%';
    if (p >= 10) return Math.round(p) + '%';
    if (p >= 1) return p.toFixed(1) + '%';
    if (p >= 0.01) return p.toFixed(2) + '%';
    return '<0.01%';
  }
  function parseYou() {
    var m = /#you=([\d.e-]+),([\d.e-]+),([\d.e-]+),(\d+)/.exec(location.hash);
    if (!m) return null;
    var v = [+m[1], +m[2], +m[3]];
    if (v.some(function (x) { return !(x >= 0 && x <= 1); })) return null;
    return { name: 'Your picks (estimated)', you: true, exact: v[0], within2: v[1], within4: v[2], racesOnBallot: +m[4], races: +m[4] };
  }
  function byKey(a, b) { return b[key] - a[key] || b.exact - a.exact; }
  function cells(rows, r) {
    var max = {};
    COLS.forEach(function (k) { max[k] = Math.max.apply(null, rows.map(function (x) { return x[k]; })); });
    var top = rows.filter(function (x) { return !x.you; })[0];
    return COLS.map(function (k) {
      var w = max[k] > 0 ? r[k] / max[k] * 100 : 0;
      return '<td class="num' + (k === key && top && r[k] === top[k] && !r.you ? ' lead' : '') + '"><span class="cell">' + pct(r[k]) + '<i style="width:' + w.toFixed(1) + '%"></i></span></td>';
    }).join('');
  }
  function name(r) { return r.you ? esc(r.name) : '<a href="' + esc(r.url) + '" target="_blank" rel="noopener">' + esc(r.name) + '</a>'; }
  function render() {
    var rows = D.guides.filter(function (r) { return showAll || r.races >= D.minRaces; });
    if (you) rows.push(you);
    rows.sort(byKey);
    document.querySelector('#tbl tbody').innerHTML = rows.map(function (r) {
      var rc = r.you ? r.races : (Math.abs(r.racesOnBallot - r.races) < 0.05 ? r.races : r.racesOnBallot.toFixed(1) + '<span class="of"> of ' + r.races + '</span>');
      return '<tr' + (r.you ? ' class="you"' : r.races < D.minRaces ? ' class="fw"' : '') + '><td class="name">' + name(r) + '</td><td class="num rc">' + rc + '</td>' + cells(rows, r) + '</tr>';
    }).join('');
    var nFair = D.guides.filter(function (r) { return r.races < D.minRaces; }).length;
    $('fair').textContent = showAll ? 'Hide fair-weather endorsers' : 'See fair-weather endorsers (' + nFair + ')';
    $('fair').setAttribute('aria-expanded', String(showAll));
    var M = D[mode], h = M.guides.slice().sort(byKey), rank = 0, prev = null, ties = [];
    $('m-common').setAttribute('aria-pressed', String(mode === 'common')); $('m-major').setAttribute('aria-pressed', String(mode === 'majority'));
    $('h2h-intro').textContent = mode === 'common'
      ? 'Longer guides are harder to match, so this ranks the ' + M.guides.length + ' guides with ' + D.minRaces + ' or more races on only the ' + M.races.length + ' races every one of them endorsed in.'
      : 'This ranks the same ' + M.guides.length + ' guides on the ' + M.races.length + ' races more than half of them endorsed in. A guide that took no position in one of these races gets a miss on every ballot that had it.';
    $('h2h-races').textContent = M.races.join(', ') + '.';
    document.querySelector('#tbl2 tbody').innerHTML = h.map(function (r, i) {
      var same = prev && COLS.every(function (k) { return r[k] === prev[k]; });
      if (!same) rank = i + 1; else ties.push(prev.name, r.name);
      prev = r;
      var sk = r.skipped && r.skipped.length ? '<span class="sk" title="' + esc(r.skipped.join(', ')) + '">No position in ' + r.skipped.length + (r.skipped.length === 1 ? ' race' : ' races') + '</span>' : '';
      return '<tr><td class="rk">' + rank + '</td><td class="name">' + name(r) + sk + '</td>' + cells(h, r) + '</tr>';
    }).join('');
    ties = ties.filter(function (x, i) { return ties.indexOf(x) === i; });
    if (mode !== 'common') ties = [];
    $('tie').hidden = !ties.length;
    if (ties.length) $('tie').textContent = ties.join(', ').replace(/, ([^,]*)$/, ' and $1') + (mode === 'common' ? ' made the same picks in all ' + M.races.length + ' races, so they tie.' : ' tie.');
    document.querySelectorAll('th button').forEach(function (b) {
      if (b.getAttribute('data-k') === key) b.setAttribute('aria-sort', 'descending'); else b.removeAttribute('aria-sort');
    });
  }
  fetch('data/power.json').then(function (r) { if (!r.ok) throw new Error('power ' + r.status); return r.json(); }).then(function (d) {
    D = d; you = parseYou();
    $('how-n').textContent = 'Counted from ' + d.nBallots.toLocaleString('en-US') + ' matched mail and QR-code ballots, through ' + d.asOf + '.';
    $('m-common').textContent = 'Races all endorsed (' + d.common.races.length + ')';
    $('m-major').textContent = 'Races most endorsed (' + d.majority.races.length + ')';
    $('m-common').addEventListener('click', function () { mode = 'common'; render(); });
    $('m-major').addEventListener('click', function () { mode = 'majority'; render(); });
    if (you) {
      $('you-note').hidden = false;
      $('you-note').textContent = 'If you had shared your picks as a guide, about ' + pct(you.exact) + ' of ballots would have matched them exactly, across the ' + you.races + ' races you marked.';
    }
    $('fair').addEventListener('click', function () { showAll = !showAll; render(); });
    document.querySelectorAll('th button').forEach(function (b) {
      b.addEventListener('click', function () { key = b.getAttribute('data-k'); render(); });
    });
    render();
  }).catch(function (err) { console.error(err); document.querySelector('#tbl tbody').innerHTML = '<tr><td colspan="5">The table did not load. Reload to try again.</td></tr>'; });
})();
