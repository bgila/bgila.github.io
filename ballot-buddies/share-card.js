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
    var x = 56, maxW = mx - x - 40, titleY = 84, footerY = H - 44;
    ctx.fillStyle = C.ink; ctx.textBaseline = 'alphabetic';
    ctx.font = '700 40px ' + FONT; ctx.fillText('SF Ballot Buddies', x, titleY);

    // Largest bloc name that fits in two lines.
    var size = 66, nameLines;
    for (;;) {
      ctx.font = '700 ' + size + 'px ' + FONT;
      nameLines = wrap(ctx, d.name, maxW);
      var fits = nameLines.length <= 2 && nameLines.every(function (l) { return ctx.measureText(l).width <= maxW; });
      if (fits || size <= 30) break;
      size -= 2;
    }
    if (nameLines.length === 2) size = Math.min(size, 58);
    ctx.font = '700 ' + size + 'px ' + FONT;

    // Each block reports its height; spacing absorbs whatever is left above the footer.
    var blocks = [];
    if (!d.generic) blocks.push({ h: 24, draw: function (y) { ctx.fillStyle = C.ink3; ctx.font = '600 24px ' + FONT; ctx.fillText('My bloc', x, y + 20); } });
    var lineH = Math.round(size * 1.08);
    blocks.push({ h: lineH * nameLines.length, tight: !d.generic, draw: function (y) {
      ctx.fillStyle = C.ink; ctx.font = '700 ' + size + 'px ' + FONT;
      nameLines.forEach(function (l, i) { ctx.fillText(l, x, y + lineH * (i + 1) - Math.round(size * 0.2)); });
    } });
    if (d.generic) {
      ctx.font = '500 26px ' + FONT;
      var blurb = wrap(ctx, 'Mark how you voted on Nov 3, 2026. See how rare your picks are and where your Buddies live.', maxW);
      blocks.push({ h: blurb.length * 36, draw: function (y) {
        ctx.fillStyle = C.ink2; ctx.font = '500 26px ' + FONT;
        blurb.forEach(function (l, i) { ctx.fillText(l, x, y + 26 + i * 36); });
      } });
    } else {
      var stats = [];
      if (d.share != null) stats.push({ text: Math.round(d.share * 100) + '% of matched SF ballots', font: '500 26px ', color: C.ink2, size: 26 });
      if (d.rarity) stats.push({ text: 'My ballot: ' + d.rarity.charAt(0).toLowerCase() + d.rarity.slice(1), font: '700 28px ', color: C.ink, size: 28 });
      if (stats.length) blocks.push({ h: stats.length * 38 - 6, draw: function (y) {
        stats.forEach(function (s, i) { ctx.fillStyle = s.color; ctx.font = s.font + FONT; ctx.fillText(s.text, x, y + s.size - 2 + i * 38); });
      } });
    }
    if (d.top.length) {
      var rowH = 34;
      blocks.push({ h: 26 + d.top.length * rowH, draw: function (y) {
        ctx.fillStyle = C.ink3; ctx.font = '600 22px ' + FONT; ctx.fillText('Where my Buddies live', x, y + 20);
        ctx.font = '600 25px ' + FONT;
        d.top.forEach(function (t, i) {
          var rowY = y + 26 + rowH * (i + 1) - 6;
          ctx.fillStyle = C.ink;
          var nm = t.name;
          while (ctx.measureText(nm).width > maxW - 90 && nm.length > 4) nm = nm.slice(0, -2);
          ctx.fillText(nm, x, rowY);
          ctx.fillStyle = C.ink2; ctx.textAlign = 'right'; ctx.fillText(t.x.toFixed(1) + '×', x + maxW, rowY); ctx.textAlign = 'left';
        });
      } });
    }
    var top = titleY + 40, bottom = footerY - 34;
    var used = blocks.reduce(function (a, b) { return a + b.h; }, 0);
    var gaps = blocks.filter(function (b, i) { return i > 0 && !b.tight; }).length;
    var gap = gaps ? Math.max(10, Math.min(30, (bottom - top - used - (d.generic ? 0 : 6)) / gaps)) : 0;
    var yy = top;
    blocks.forEach(function (b, i) {
      if (i > 0) yy += b.tight ? 6 : gap;
      b.draw(yy);
      yy += b.h;
    });
    ctx.fillStyle = C.ink3; ctx.font = '600 22px ' + FONT;
    ctx.fillText('Find yours: barakgila.com/ballot-buddies', x, footerY);
    return { contentBottom: yy, limit: bottom, nameSize: size };
  }
  window.BallotCard = {
    draw: draw,
    ready: function () {
      if (!document.fonts || !document.fonts.load) return Promise.resolve();
      return Promise.all([document.fonts.load('700 40px Raleway'), document.fonts.load('600 24px Raleway'), document.fonts.load('500 26px Raleway')]).catch(function (err) { console.error(err); });
    }
  };
})();
