(function () {
  'use strict';
  var C = { bg: '#f4f1ea', ink: '#1b1d21', ink2: '#3f434a', ink3: '#676c75', map: '#f7f4ee', s: ['#ece7da', '#d5e8db', '#a6d0b5', '#6fb08b', '#357f5a', '#14532d'], rule: '#e3ded3' };
  var FONT = 'Raleway, -apple-system, "Segoe UI", Helvetica, Arial, sans-serif';
  function wrap(ctx, text, maxW) {
    var words = String(text).split(/\s+/), lines = [], line = '';
    words.forEach(function (w) {
      var t = line ? line + ' ' + w : w;
      if (ctx.measureText(t).width > maxW && line) { lines.push(line); line = w; } else line = t;
    });
    if (line) lines.push(line);
    return lines;
  }
  function draw(canvas, d) {
    var W = 1200, H = 630, ctx;
    canvas.width = W; canvas.height = H;
    ctx = canvas.getContext('2d');
    ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H);
    var mapSize = 574, mx = W - mapSize - 28, my = 28;
    ctx.fillStyle = C.map; ctx.beginPath(); ctx.roundRect(mx, my, mapSize, mapSize, 20); ctx.fill();
    var inner = mapSize - 28, k = Math.min(inner / d.w, inner / d.h);
    ctx.save();
    ctx.translate(mx + (mapSize - d.w * k) / 2, my + (mapSize - d.h * k) / 2);
    ctx.scale(k, k);
    ctx.lineWidth = 0.7 / k; ctx.strokeStyle = '#ffffff'; ctx.lineJoin = 'round';
    d.paths.forEach(function (p) {
      var path = new Path2D(p.d);
      ctx.fillStyle = C.s[p.step] || C.s[0];
      ctx.fill(path); ctx.stroke(path);
    });
    ctx.restore();
    var x = 56, maxW = mx - x - 40, y = 84;
    ctx.fillStyle = C.ink; ctx.textBaseline = 'alphabetic';
    ctx.font = '700 40px ' + FONT; ctx.fillText('SF Ballot Buddies', x, y);
    y += 62;
    if (!d.generic) { ctx.fillStyle = C.ink3; ctx.font = '600 24px ' + FONT; ctx.fillText('My bloc', x, y); y += 16; }
    var size = 66, lines;
    do { ctx.font = '700 ' + size + 'px ' + FONT; lines = wrap(ctx, d.name, maxW); size -= 2; } while ((lines.length > 2 || lines.some(function (l) { return ctx.measureText(l).width > maxW; })) && size > 30);
    size += 2;
    ctx.fillStyle = C.ink;
    lines.forEach(function (l) { y += size * 1.1; ctx.fillText(l, x, y); });
    y += 52;
    ctx.fillStyle = C.ink2; ctx.font = '500 26px ' + FONT;
    if (d.generic) {
      wrap(ctx, 'Mark how you voted on Nov 3, 2026. See how rare your picks are and where your Buddies live.', maxW).forEach(function (l) { ctx.fillText(l, x, y); y += 36; });
    } else if (d.share != null) {
      ctx.fillText(Math.round(d.share * 100) + '% of matched SF ballots', x, y); y += 36;
    }
    if (d.rarity) {
      y += 8; ctx.fillStyle = C.ink; ctx.font = '700 30px ' + FONT; ctx.fillText('My ballot: ' + d.rarity.charAt(0).toLowerCase() + d.rarity.slice(1), x, y); y += 12;
    }
    if (d.top.length) {
      y += 40; ctx.fillStyle = C.ink3; ctx.font = '600 22px ' + FONT; ctx.fillText('Where my Buddies live', x, y); y += 8;
      ctx.font = '600 25px ' + FONT;
      d.top.forEach(function (t) {
        y += 36; ctx.fillStyle = C.ink;
        var nm = t.name; while (ctx.measureText(nm).width > maxW - 90 && nm.length > 4) nm = nm.slice(0, -2);
        ctx.fillText(nm, x, y);
        ctx.fillStyle = C.ink2; ctx.textAlign = 'right'; ctx.fillText(t.x.toFixed(1) + '×', x + maxW, y); ctx.textAlign = 'left';
      });
    }
    ctx.fillStyle = C.ink3; ctx.font = '600 22px ' + FONT;
    ctx.fillText('Find yours: barakgila.com/ballot-buddies', x, H - 44);
  }
  window.BallotCard = {
    draw: draw,
    ready: function () {
      if (!document.fonts || !document.fonts.load) return Promise.resolve();
      return Promise.all([document.fonts.load('700 40px Raleway'), document.fonts.load('600 24px Raleway'), document.fonts.load('500 26px Raleway')]).catch(function (err) { console.error(err); });
    }
  };
})();
