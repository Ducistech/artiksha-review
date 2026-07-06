/* Artiksha Reviews storefront widget.
   Reads config from the block container, fetches published reviews from the app
   proxy, renders summary + list, and handles review submission. No dependencies. */
(function () {
  "use strict";

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function stars(n) {
    n = Math.max(0, Math.min(5, Math.round(n)));
    return '<span class="akr-stars" aria-hidden="true">' + "★".repeat(n) + "☆".repeat(5 - n) + "</span>";
  }

  function fmtDate(iso) {
    if (!iso) return "";
    try {
      return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
    } catch (e) {
      return "";
    }
  }

  function renderSummary(el, summary) {
    if (!summary || !summary.count) {
      el.innerHTML = '<span class="akr-muted">No reviews yet — be the first!</span>';
      return;
    }
    el.innerHTML =
      stars(summary.average) +
      '<span class="akr-avg">' + summary.average.toFixed(1) + "</span>" +
      '<span class="akr-count">(' + summary.count + " review" + (summary.count === 1 ? "" : "s") + ")</span>";
  }

  function renderList(el, reviews) {
    if (!reviews || !reviews.length) {
      el.innerHTML = '<p class="akr-muted">No reviews yet.</p>';
      return;
    }
    el.innerHTML = reviews
      .map(function (r) {
        var badge = r.source === "google"
          ? '<span class="akr-badge akr-badge--google">Google</span>'
          : r.verified
            ? '<span class="akr-badge akr-badge--verified">Verified buyer</span>'
            : "";
        var photos = (r.photoUrls || [])
          .slice(0, 6)
          .map(function (u) { return '<img class="akr-photo" src="' + esc(u) + '" alt="" loading="lazy">'; })
          .join("");
        var reply = r.reply
          ? '<div class="akr-reply"><strong>Artiksha:</strong> ' + esc(r.reply) + "</div>"
          : "";
        return (
          '<article class="akr-item">' +
          '<div class="akr-item-head">' + stars(r.rating) +
          '<span class="akr-author">' + esc(r.authorName) + "</span>" + badge +
          '<span class="akr-date">' + esc(fmtDate(r.date)) + "</span></div>" +
          (r.title ? '<h3 class="akr-item-title">' + esc(r.title) + "</h3>" : "") +
          '<p class="akr-item-body">' + esc(r.body) + "</p>" +
          (photos ? '<div class="akr-photos">' + photos + "</div>" : "") +
          reply +
          "</article>"
        );
      })
      .join("");
  }

  function initWidget(root) {
    var proxy = root.getAttribute("data-proxy");
    var productId = root.getAttribute("data-product-id");
    var listEl = root.querySelector("[data-akr-list]");
    var summaryEl = root.querySelector("[data-akr-summary]");

    function load() {
      var url = proxy + "?productId=" + encodeURIComponent(productId);
      fetch(url, { headers: { Accept: "application/json" } })
        .then(function (r) { return r.json(); })
        .then(function (data) {
          renderSummary(summaryEl, data.summary);
          renderList(listEl, data.reviews);
        })
        .catch(function () {
          listEl.innerHTML = '<p class="akr-muted">Could not load reviews right now.</p>';
        });
    }

    // --- submit form ---
    var form = root.querySelector("[data-akr-form]");
    if (form) {
      var openBtn = root.querySelector("[data-akr-open-form]");
      var cancelBtn = root.querySelector("[data-akr-cancel]");
      var msg = root.querySelector("[data-akr-msg]");
      var ratingInput = form.querySelector('input[name="rating"]');
      var starBtns = form.querySelectorAll("[data-akr-stars] .akr-star");

      openBtn && openBtn.addEventListener("click", function () {
        form.hidden = false;
        openBtn.hidden = true;
      });
      cancelBtn && cancelBtn.addEventListener("click", function () {
        form.hidden = true;
        if (openBtn) openBtn.hidden = false;
      });

      starBtns.forEach(function (b) {
        b.addEventListener("click", function () {
          var v = b.getAttribute("data-val");
          ratingInput.value = v;
          starBtns.forEach(function (x) {
            x.classList.toggle("is-on", Number(x.getAttribute("data-val")) <= Number(v));
          });
        });
      });

      // Photo picker: show thumbnail previews of chosen files.
      var fileInput = form.querySelector("[data-akr-files]");
      var previews = form.querySelector("[data-akr-previews]");
      if (fileInput && previews) {
        fileInput.addEventListener("change", function () {
          previews.innerHTML = "";
          var files = Array.prototype.slice.call(fileInput.files || []).slice(0, 4);
          files.forEach(function (f) {
            if (!/^image\//.test(f.type)) return;
            var img = document.createElement("img");
            img.className = "akr-preview";
            img.src = URL.createObjectURL(f);
            img.onload = function () { URL.revokeObjectURL(img.src); };
            previews.appendChild(img);
          });
        });
      }

      form.addEventListener("submit", function (e) {
        e.preventDefault();
        msg.textContent = "";
        if (!ratingInput.value) {
          msg.textContent = "Please pick a star rating.";
          msg.className = "akr-form-msg is-error";
          return;
        }
        var submitBtn = form.querySelector(".akr-submit");
        submitBtn.disabled = true;
        // Send as multipart FormData so photo files upload; browser sets the boundary header.
        var fd = new FormData(form);

        fetch(proxy, {
          method: "POST",
          headers: { Accept: "application/json" },
          body: fd,
        })
          .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
          .then(function (res) {
            submitBtn.disabled = false;
            if (!res.ok || res.j.ok === false) {
              var errs = res.j.errors ? Object.values(res.j.errors).join(" ") : "Something went wrong.";
              msg.textContent = errs;
              msg.className = "akr-form-msg is-error";
              return;
            }
            msg.textContent = res.j.message || "Thanks for your review!";
            msg.className = "akr-form-msg is-ok";
            form.reset();
            starBtns.forEach(function (x) { x.classList.remove("is-on"); });
            if (!res.j.moderated) load(); // if auto-published, refresh the list
          })
          .catch(function () {
            submitBtn.disabled = false;
            msg.textContent = "Could not submit right now. Please try again.";
            msg.className = "akr-form-msg is-error";
          });
      });
    }

    load();
  }

  function boot() {
    document.querySelectorAll(".artiksha-reviews").forEach(initWidget);
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
