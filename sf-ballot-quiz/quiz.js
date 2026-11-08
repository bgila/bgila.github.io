(function () {
  'use strict';
  var SETS = 5, MAX = SETS * 3 * 10;
  var D, game, toastTimer;
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function toast(msg) { var t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.classList.remove('show'); }, 2600); }
  function shuffle(a) { for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)), t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
  function points(guess, real) { var d = Math.abs(guess - real); return d <= 5 ? 10 : d <= 10 ? 5 : d <= 20 ? 1 : 0; }
  var CHIP = { 10: 'Spot on', 5: 'Close', 1: 'In the ballpark', 0: 'Missed' };
  var GRADES = [[93, 'A+', 'Golden Gate God'], [86, 'A', 'Sutro Star'], [80, 'A-', 'Coit Tower Oracle'], [75, 'B+', 'Twin Peaks Pundit'],
    [70, 'B', 'Dolores Park Pollster'], [65, 'B-', 'Ferry Building Philosopher'], [60, 'C+', 'Muni Regular'], [56, 'C', 'Clipper Card Commuter'],
    [52, 'C-', 'Karl the Fog Forecaster'], [48, 'D+', 'Marina Transplant'], [44, 'D', 'Haight Rookie'], [40, 'D-', 'Fisherman\'s Wharf Tourist'], [0, 'F', 'New Resident']];
  function band(p) { for (var i = 0; i < GRADES.length; i++) if (p >= GRADES[i][0]) return GRADES[i]; return GRADES[GRADES.length - 1]; }
  function grade(p) { return band(p)[1]; }
  function epithet(g) { for (var i = 0; i < GRADES.length; i++) if (GRADES[i][1] === g) return GRADES[i][2]; return ''; }
  function who(q) { return q.who === 'voters' ? 'SF voters' : q.who; }
  function verb(q) {
    if (q.yesno) return 'voted ' + q.label;
    if (q.multi) return 'marked ' + q.label;
    if (q.rcv) return 'picked ' + q.label.replace(' for ', ' first for ');
    return 'picked ' + q.label;
  }
  function uncond(q) { return 'What percent of ' + who(q) + ' ' + verb(q) + '?'; }
  function cond(a, b) { return 'Of the ' + (b.who !== 'voters' ? b.who : 'people') + ' who ' + verb(a) + ', what percent ' + verb(b) + '?'; }
  function side(k) { var q = D.q[k]; return q.alt && Math.random() < 0.5 ? q.alt : k; }
  function newGame() {
    var cond = {};
    D.pairs.forEach(function (p) { cond[p[0] + '>' + p[1]] = p[2]; });
    var sets = [], used = {};
    shuffle(D.A.slice()).some(function (ab) {
      if (used[D.q[ab].item]) return false;
      var a = side(ab), pick = null;
      shuffle(D.B.slice()).some(function (bb) {
        if (used[D.q[bb].item] || D.q[bb].item === D.q[a].item) return false;
        var b = side(bb), alt = D.q[b].alt;
        if (cond[a + '>' + b] == null && alt) b = alt;
        if (cond[a + '>' + b] == null) return false;
        pick = b; return true;
      });
      if (!pick) return false;
      used[D.q[a].item] = used[D.q[pick].item] = true;
      sets.push({ a: D.q[a], b: D.q[pick], cond: cond[a + '>' + pick], guess: {} });
      return sets.length >= SETS;
    });
    game = { sets: sets, step: 0, locked: false };
    render();
  }
  function sliderHTML(id, value, prompt, hint) {
    return '<div class="q"><p class="prompt">' + esc(prompt) + '</p>' + (hint ? '<p class="hint">' + esc(hint) + '</p>' : '') +
      '<div class="guess-row"><button class="step" data-step="-1" data-for="' + id + '" aria-label="Lower">−</button><span class="big" id="' + id + '-v">' + value + '%</span><button class="step" data-step="1" data-for="' + id + '" aria-label="Higher">+</button></div>' +
      '<input type="range" min="0" max="100" step="1" value="' + value + '" id="' + id + '" aria-label="' + esc(prompt) + '">' +
      '<div class="reveal" id="' + id + '-r"></div></div>';
  }
  function revealHTML(guess, real) {
    var pts = points(guess, real);
    function lab(x) { return Math.min(88, Math.max(12, x)); }
    return '<div class="track"><i class="tick you" style="left:' + guess + '%"></i><i class="tick real" style="left:' + real + '%"></i><span class="mark you" style="left:' + lab(guess) + '%">You ' + guess + '%</span><span class="mark real" style="left:' + lab(real) + '%">Actual ' + Math.round(real) + '%</span></div>' +
      '<div class="verdict"><span>Actual: <b>' + Math.round(real) + '%</b></span><span class="chip p' + pts + '">+' + pts + ' · ' + CHIP[pts] + '</span></div>';
  }
  function pts(n) { return n + (n === 1 ? ' point' : ' points'); }
  function total() {
    var t = 0;
    game.sets.forEach(function (s) { ['a', 'b', 'c'].forEach(function (k) { if (s.guess[k] != null) t += s.pts[k]; }); });
    return t;
  }
  function render() {
    var box = $('game');
    if (game.step >= SETS * 2) { renderResult(); return; }
    var set = game.sets[Math.floor(game.step / 2)], second = game.step % 2 === 1, n = game.step + 1;
    var html = '<div class="progress"><span>Question ' + n + ' of ' + SETS * 2 + '</span><span>' + pts(total()) + '</span></div><div class="meter"><i style="width:' + (game.step / (SETS * 2) * 100) + '%"></i></div>';
    if (!second) {
      html += sliderHTML('ga', 50, uncond(set.a), '') + sliderHTML('gb', 50, uncond(set.b), '');
    } else {
      var start = Math.round(set.b.pct);
      html += sliderHTML('gc', start, cond(set.a, set.b), 'The slider starts at the citywide answer, ' + start + '%.');
    }
    html += '<div class="actions"><button class="btn primary" id="lock">Lock in</button></div>';
    box.innerHTML = html;
    game.locked = false;
    box.querySelectorAll('input[type=range]').forEach(function (r) {
      r.addEventListener('input', function () { $(r.id + '-v').textContent = r.value + '%'; });
    });
    $('lock').addEventListener('click', lock);
  }
  function lock() {
    if (game.locked) { game.step++; render(); window.scrollTo({ top: $('game').offsetTop - 12, behavior: 'smooth' }); return; }
    var set = game.sets[Math.floor(game.step / 2)], second = game.step % 2 === 1;
    set.pts = set.pts || {};
    var ids = second ? [['gc', 'c', set.cond]] : [['ga', 'a', set.a.pct], ['gb', 'b', set.b.pct]];
    ids.forEach(function (x) {
      var g = +$(x[0]).value; set.guess[x[1]] = g; set.pts[x[1]] = points(g, x[2]);
      $(x[0] + '-r').innerHTML = revealHTML(g, x[2]);
      $(x[0]).disabled = true;
    });
    $('game').querySelectorAll('.step').forEach(function (b) { b.disabled = true; });
    game.locked = true;
    $('lock').textContent = game.step + 1 >= SETS * 2 ? 'See my score' : 'Next';
    $('game').querySelector('.progress span:last-child').textContent = pts(total());
  }
  function renderResult() {
    var t = total(), pct = t / MAX * 100, g = grade(pct), ep = epithet(g);
    var rows = [];
    game.sets.forEach(function (s) {
      rows.push([uncond(s.a), s.guess.a, s.a.pct, s.pts.a]);
      rows.push([uncond(s.b), s.guess.b, s.b.pct, s.pts.b]);
      rows.push([cond(s.a, s.b), s.guess.c, s.cond, s.pts.c]);
    });
    $('game').innerHTML = '<div class="result"><div class="grade">' + g + '</div><p class="epithet">' + ep + '</p><p class="score">' + t + ' of ' + MAX + ' points</p>' +
      '<div class="actions"><button class="btn primary" id="share">Share my score</button><button class="btn" id="img">Copy image</button><button class="btn" id="again">Play again</button></div></div>' +
      '<ol class="breakdown">' + rows.map(function (r) { return '<li><span class="lab">' + esc(r[0]) + '</span><span class="nums">You ' + r[1] + '% · Actual ' + Math.round(r[2]) + '% · +' + r[3] + '</span></li>'; }).join('') + '</ol>';
    game.result = { score: t, grade: g, epithet: ep };
    $('again').addEventListener('click', newGame);
    $('share').addEventListener('click', share);
    $('img').addEventListener('click', copyImage);
  }
  function shareURL() { return location.href.split('#')[0] + '#r=' + game.result.score; }
  function shareText() { return 'I got ' + game.result.grade + ' (' + game.result.epithet + ') on the SF Ballot Quiz: ' + game.result.score + ' of ' + MAX + '. Can you beat me?'; }
  function copyText(s, ok) {
    function fallback() {
      var ta = document.createElement('textarea'); ta.value = s; document.body.appendChild(ta); ta.select();
      var done = false; try { done = document.execCommand('copy'); } catch (err) { console.error(err); }
      document.body.removeChild(ta); toast(done ? ok : 'Could not copy. Your browser blocked it.');
    }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(s).then(function () { toast(ok); }, fallback); else fallback();
  }
  function share() {
    var text = shareText(), url = shareURL();
    if (navigator.share && /Mobi|Android|iPhone|iPad/.test(navigator.userAgent)) {
      navigator.share({ title: 'SF Ballot Quiz', text: text, url: url }).catch(function (err) { if (err && err.name !== 'AbortError') console.error(err); });
    } else copyText(text + ' ' + url, 'Score and link copied.');
  }
  function drawCard(c, r) {
    var W = 1200, H = 630, ctx; c.width = W; c.height = H; ctx = c.getContext('2d');
    var F = 'Raleway, -apple-system, "Segoe UI", Helvetica, Arial, sans-serif';
    ctx.fillStyle = '#f4f1ea'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#1b1d21'; ctx.font = '700 44px ' + F; ctx.fillText('SF Ballot Quiz', 72, 110);
    ctx.fillStyle = '#3f434a'; ctx.font = '500 30px ' + F; ctx.fillText('How well do you know how San Francisco voted?', 72, 160);
    if (r) {
      ctx.fillStyle = '#14532d'; ctx.font = '800 220px ' + F; ctx.fillText(r.grade, 66, 410);
      ctx.fillStyle = '#1b1d21'; ctx.font = '700 56px ' + F; ctx.fillText(r.epithet, 72, 490);
      ctx.fillStyle = '#3f434a'; ctx.font = '600 32px ' + F; ctx.fillText(r.score + ' of ' + MAX + ' points. Can you beat me?', 72, 540);
    } else {
      ctx.fillStyle = '#14532d'; ctx.font = '800 120px ' + F; ctx.fillText('10 questions', 66, 360);
      ctx.fillStyle = '#1b1d21'; ctx.font = '700 48px ' + F; ctx.fillText('From New Resident to Golden Gate God', 72, 450);
    }
    ctx.fillStyle = '#676c75'; ctx.font = '600 26px ' + F; ctx.fillText('barakgila.com/sf-ballot-quiz', 72, H - 50);
  }
  function fontsReady() { return document.fonts && document.fonts.load ? Promise.all([document.fonts.load('800 60px Raleway'), document.fonts.load('700 40px Raleway')]).catch(function (err) { console.error(err); }) : Promise.resolve(); }
  function copyImage() {
    var png = fontsReady().then(function () { return new Promise(function (res, rej) { var c = document.createElement('canvas'); drawCard(c, game.result); c.toBlob(function (b) { if (b) res(b); else rej(new Error('image')); }, 'image/png'); }); });
    function save(b) { var a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = 'sf-ballot-quiz.png'; document.body.appendChild(a); a.click(); document.body.removeChild(a); }
    if (navigator.clipboard && window.ClipboardItem) {
      navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]).then(function () { toast('Image copied.'); }, function (err) { console.error(err); png.then(function (b) { save(b); toast('Saved the image instead.'); }); });
    } else png.then(function (b) { save(b); toast('Saved the image.'); });
  }
  window.SFQuiz = { sample: function () { newGame(); return game.sets.map(function (s) { return [s.a.key, s.b.key, s.cond]; }); }, renderOG: function () { var c = document.createElement('canvas'); drawCard(c, null); return c.toDataURL('image/jpeg', 0.86); } };
  fetch('data/quiz.json').then(function (r) { if (!r.ok) throw new Error('quiz ' + r.status); return r.json(); }).then(function (d) {
    D = d;
    var m = /#r=(\d{1,3})/.exec(location.hash);
    if (m && +m[1] <= MAX) { var s = +m[1], g = grade(s / MAX * 100); $('friend').hidden = false; $('friend').textContent = 'A friend got ' + g + ' (' + epithet(g) + ') with ' + s + ' of ' + MAX + ' points. Can you beat them?'; }
    $('fine').textContent = 'Results through ' + d.asOf + '. Citywide and district answers come from official totals, with ranked races counted by first choice. "Of the people who" answers come from about 260,000 matched mail and QR ballots. Scoring per answer: within 5 points earns 10, within 10 earns 5, within 20 earns 1.';
    newGame();
    document.addEventListener('click', function (e) {
      var b = e.target.closest('.step'); if (!b || b.disabled) return;
      var r = $(b.getAttribute('data-for')); r.value = Math.max(0, Math.min(100, +r.value + +b.getAttribute('data-step'))); r.dispatchEvent(new Event('input'));
    });
  }).catch(function (err) { console.error(err); $('game').innerHTML = '<p class="muted">The quiz did not load. Reload to try again.</p>'; });
})();
