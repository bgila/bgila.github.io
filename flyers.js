(function () {
  function trackEvent(name, params) {
    if (typeof gtag === 'function') {
      gtag('event', name, params || {});
    }
  }

  document.addEventListener('DOMContentLoaded', function () {
    var campaign = document.body.getAttribute('data-campaign') || '';

    var ctas = document.querySelectorAll('[data-cta]');
    for (var i = 0; i < ctas.length; i++) {
      (function (el) {
        var cta = el.getAttribute('data-cta');

        if (cta === 'share') {
          el.addEventListener('click', function () {
            var url = el.getAttribute('data-share-url');
            var label = el.querySelector('.cta-label');
            var original = label.textContent;

            function showCopied() {
              label.textContent = 'Copied!';
              setTimeout(function () { label.textContent = original; }, 1500);
            }

            if (navigator.clipboard && navigator.clipboard.writeText) {
              navigator.clipboard.writeText(url).then(showCopied);
            } else {
              var input = document.createElement('textarea');
              input.value = url;
              input.style.position = 'fixed';
              input.style.opacity = '0';
              document.body.appendChild(input);
              input.select();
              document.execCommand('copy');
              document.body.removeChild(input);
              showCopied();
            }

            trackEvent('share', {
              method: 'copy_link',
              content_type: 'ad_landing_page',
              item_id: campaign
            });
          });
        } else {
          el.addEventListener('click', function () {
            trackEvent('cta_click', {
              cta_type: cta,
              campaign: campaign
            });
          });
        }
      })(ctas[i]);
    }
  });
})();
