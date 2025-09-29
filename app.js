/* Debug flags */
const DEBUG = true;           // logs key steps
const LOG_FIRST_ITEM = true;  // dumps first item attributes to help map fields

/* Proxy base (Netlify redirects -> Givebutter) */
const BASE_URL = "/api/auctions/38788/items";
/* Keep the same filters/sort as your original URL (minus page); we’ll append &page=1..N */
const BASE_QS  = "?filters=%7B%22categories%22%3A%5B%5D%2C%22status%22%3Anull%2C%22minPrice%22%3Anull%2C%22maxPrice%22%3Anull%2C%22allItems%22%3Afalse%7D&sortBy=ending_soonest&searchBy=&isFavorited=false&isMyBids=false&perPage=28";

/* State */
let allItems = [];
let filtered = [];
let sort = { key: "ends", dir: "asc" };

/* DOM refs */
const tbody = document.getElementById("tbody");
const kpiItems = document.getElementById("kpi-items");
const kpiWithBids = document.getElementById("kpi-with-bids");
const kpiTotalBids = document.getElementById("kpi-total-bids");
const kpiHighestBid = document.getElementById("kpi-highest-bid");
const kpiSoonest = document.getElementById("kpi-soonest");
const kpiAvgBid = document.getElementById("kpi-avg-bid");

const sumItems = document.getElementById("sum-items");
const sumWithBids = document.getElementById("sum-with-bids");
const sumTotal = document.getElementById("sum-total");
const sumAvg = document.getElementById("sum-avg");
const sumMax = document.getElementById("sum-max");
const sumMaxItem = document.getElementById("sum-max-item");

const lastUpdated = document.getElementById("last-updated");
const note = document.getElementById("note");
const alertBox = document.getElementById("alert");

const searchInput = document.getElementById("search");
const clearSearchBtn = document.getElementById("clear-search");
const onlyWithBidsCb = document.getElementById("only-with-bids");
const refreshBtn = document.getElementById("refresh-btn");
const autoRefreshCb = document.getElementById("auto-refresh");
const refreshSeconds = document.getElementById("refresh-seconds");
const refreshEveryLabel = document.getElementById("refresh-every");

/* Helpers */
const fmtMoney = n => Number(n || 0).toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 2 });
const safeText = s => (s == null ? "" : String(s));

/* Try to parse a numeric value that might be:
   - number
   - string with $/commas
   - cents integer (we detect *_cents fields separately)
*/
function parseNumber(v) {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = Number(v.replace(/[^0-9.\-]/g, ""));
    return isNaN(n) ? 0 : n;
  }
  return 0;
}

/* Dates */
const parseDate = s => (s ? new Date(s) : null);
const timeShort = d => (d ? d.toLocaleString() : "–");

/* Field mapper with robust fallbacks */
function mapItem(raw) {
  // Your schema is flat (no attributes/relationships)
  const title = raw.name || `Item ${raw.id ?? ""}`;
  const lot = raw.number != null ? String(raw.number) : ""; // or use another field if you have explicit lot numbers
  const image = Array.isArray(raw.pictures) && raw.pictures[0]?.url ? raw.pictures[0].url : null;

  // Current bid comes from last_bid.amount (string like "18.00")
  const currentPrice = raw.last_bid?.amount ? Number(String(raw.last_bid.amount).replace(/[^0-9.\-]/g, "")) : 0;

  // Count of bids
  const bidsCount = Number(raw.bid_count ?? 0);

  // Leading bidder display name
  const bidder = raw.last_bid?.bidder?.display_name || "";

  // Status and end time
  const endsAt = raw.end_at ? new Date(raw.end_at.replace(" ", "T") + (raw.end_at.endsWith("Z") ? "" : "Z")) : null;
  // Derive a simple status string
  let status = "open";
  if (raw.paused) status = "paused";
  if (raw.ended) status = "closed";
  if (!raw.started) status = "pending";

  // Buy-now: your sample shows allows_buy_now: false, but handle if present in others
  const buyNow = raw.final_price ? Number(String(raw.final_price).replace(/[^0-9.\-]/g, "")) : 0;

  // Helpful extras
  const nextMinBid = raw.minimum_bid != null ? Number(raw.minimum_bid) : null;      // 20 in your sample
  const startBid   = raw.start_bid != null ? Number(raw.start_bid) : null;          // "10.00" -> 10
  const link       = raw.url || (raw.id ? `https://givebutter.com/auctions/${raw.auction_id}/items/${raw.id}` : "");

  return {
    id: raw.id,
    title,
    lot,
    image,
    currentPrice,
    bidsCount,
    bidder,
    status,
    endsAt,
    buyNow,
    nextMinBid,
    startBid,
    link,
    raw
  };
}


/* Render */
function render(items) {
  // Sorting
  const sorted = [...items].sort((a, b) => {
    const dir = sort.dir === "asc" ? 1 : -1;
    switch (sort.key) {
      case "title": return a.title.localeCompare(b.title) * dir;
      case "lot": return a.lot.localeCompare(b.lot, undefined, { numeric: true }) * dir;
      case "price": return (a.currentPrice - b.currentPrice) * dir;
      case "bids": return (a.bidsCount - b.bidsCount) * dir;
      case "bidder": return a.bidder.localeCompare(b.bidder) * dir;
      case "ends": {
        const at = a.endsAt ? a.endsAt.getTime() : Infinity;
        const bt = b.endsAt ? b.endsAt.getTime() : Infinity;
        return (at - bt) * dir;
      }
      case "status": return a.status.localeCompare(b.status) * dir;
      default: return 0;
    }
  });

  // Body
  if (sorted.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" class="center muted">No items match your filters.</td></tr>`;
  } else {
    tbody.innerHTML = sorted.map(item => {
      const statusClass = item.status === "open" ? "status-open" : item.status === "closed" ? "status-closed" : "";
      return `
        <tr>
          <td>
            <div style="display:flex;flex-direction:column;gap:4px">
              <div>${escapeHtml(item.title)}</div>
              ${item.link ? `<a class="link muted" href="${escapeAttr(item.link)}" target="_blank" rel="noopener">Open item ↗</a>` : ""}

            </div>
          </td>
          <td class="nowrap">${escapeHtml(item.lot || "")}</td>
          <td>${item.image ? `<img class="thumb" src="${escapeAttr(item.image)}" alt="item image">` : `<span class="muted">—</span>`}</td>
          <td class="price">${fmtMoney(item.currentPrice)}</td>
          <td class="nowrap">${item.bidsCount}</td>
          <td>${item.bidder ? escapeHtml(item.bidder) : `<span class="muted">—</span>`}</td>
          <td class="nowrap">${item.endsAt ? escapeHtml(timeShort(item.endsAt)) : `<span class="muted">—</span>`}</td>
          <td><span class="status-chip ${statusClass}">${escapeHtml(item.status || "—")}</span></td>
          <td class="price">${fmtMoney(item.buyNow)}</td>
        </tr>
      `;
    }).join("");
  }

  // KPIs & Summary (totals)
  const count = items.length;
  const withBids = items.filter(i => (i.bidsCount || 0) > 0);
  const total = withBids.reduce((s, i) => s + i.currentPrice, 0);
  const maxItem = withBids.reduce((max, i) => i.currentPrice > (max?.currentPrice || 0) ? i : max, null);
  const avg = withBids.length ? (total / withBids.length) : 0;
  const soonest = items.filter(i => i.endsAt && i.status !== "closed").sort((a,b) => a.endsAt - b.endsAt)[0]?.endsAt || null;

  kpiItems.textContent = count;
  kpiWithBids.textContent = withBids.length;
  kpiTotalBids.textContent = fmtMoney(total);
  kpiHighestBid.textContent = fmtMoney(maxItem?.currentPrice || 0);
  kpiSoonest.textContent = soonest ? timeShort(soonest) : "–";
  kpiAvgBid.textContent = fmtMoney(avg);

  sumItems.textContent = count;
  sumWithBids.textContent = withBids.length;
  sumTotal.textContent = fmtMoney(total);
  sumAvg.textContent = fmtMoney(avg);
  sumMax.textContent = fmtMoney(maxItem?.currentPrice || 0);
  sumMaxItem.textContent = maxItem ? ` (${maxItem.title})` : "";

  if (DEBUG) {
    console.log(`[render] items=${count} withBids=${withBids.length} total=${total} avg=${avg}`);
  }
}

/* Escaping */
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function escapeAttr(s) { return escapeHtml(s).replace(/"/g, '&quot;'); }

/* Filters */
function applyFilters() {
  const q = searchInput.value.trim().toLowerCase();
  const onlyBids = onlyWithBidsCb.checked;
  filtered = allItems.filter(i => {
    if (onlyBids && !(i.currentPrice > 0)) return false;
    if (!q) return true;
    const hay = `${i.title} ${i.bidder} ${i.lot}`.toLowerCase();
    return hay.includes(q);
  });
  render(filtered);
}

/* Sorting (header clicks) */
document.querySelectorAll("thead th[data-sort]").forEach(th => {
  th.addEventListener("click", () => {
    const key = th.dataset.sort;
    if (sort.key === key) {
      sort.dir = sort.dir === "asc" ? "desc" : "asc";
    } else {
      sort.key = key;
      sort.dir = key === "title" || key === "bidder" || key === "status" ? "asc" : "desc";
    }
    render(filtered);
  });
});

/* Fetch pages until empty (safety cap) */
async function fetchAllPages() {
  const cap = 50;
  let page = 1;
  const items = [];
  while (page <= cap) {
    const url = `${BASE_URL}${BASE_QS}&page=${page}`;
    const data = await fetchJson(url);
    const arr = Array.isArray(data?.data) ? data.data : [];
    if (DEBUG) console.log(`[fetchAllPages] page=${page} items=${arr.length}`);
    if (arr.length === 0) break;
    items.push(...arr);
    page++;
  }
  return items;
}

async function fetchJson(url) {
  const res = await fetch(url, { headers: { "Accept": "application/json" } });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status} – ${res.statusText}\n${txt.slice(0, 300)}`);
  }
  return res.json();
}

/* Status UI */
function setStatus(kind, message) {
  if (!message) { alertBox.innerHTML = ""; return; }
  alertBox.innerHTML = `<div class="${kind === 'warn' ? 'warn' : 'error'}">${escapeHtml(message)}</div>`;
}

/* Refresh flow */
async function refresh() {
  setStatus("", "");
  tbody.innerHTML = `<tr><td colspan="9" class="center muted">Loading…</td></tr>`;
  try {
    const itemsRaw = await fetchAllPages();
    if (DEBUG) console.log(`[refresh] total raw items: ${itemsRaw.length}`, itemsRaw);

    if (LOG_FIRST_ITEM && itemsRaw[0]) {
      console.log("[debug] first item attributes:", itemsRaw[0].attributes || {});
      console.log("[debug] first item relationships:", itemsRaw[0].relationships || {});
    }

    allItems = itemsRaw.map(mapItem);

    // If all prices are 0, but *_cents exist, you’ll see it in the debug dump above.
    // You can quickly tweak mapItem to point at the right fields.

    applyFilters();
    lastUpdated.textContent = new Date().toLocaleTimeString();
    note.textContent = `${allItems.length} items loaded.`;
  } catch (err) {
    console.error(err);
    tbody.innerHTML = `<tr><td colspan="9" class="center"><div class="error">Failed to load items.<br>${escapeHtml(err.message)}</div></td></tr>`;
    setStatus("warn", "If you see a CORS error, make sure netlify.toml is deployed at the repo root and that you’re calling /api/... in app.js.");
  }
}

/* Controls */
searchInput.addEventListener("input", applyFilters);
onlyWithBidsCb.addEventListener("change", applyFilters);
clearSearchBtn.addEventListener("click", () => { searchInput.value = ""; applyFilters(); });
refreshBtn.addEventListener("click", () => refresh());

/* Auto-refresh */
let timer = null;
function scheduleAutoRefresh() {
  if (timer) clearInterval(timer);
  const secs = Math.max(10, Number(refreshSeconds.value || 60));
  refreshEveryLabel.textContent = `${secs}s`;
  if (autoRefreshCb.checked) {
    timer = setInterval(refresh, secs * 1000);
    if (DEBUG) console.log(`[auto] refresh every ${secs}s`);
  }
}
autoRefreshCb.addEventListener("change", scheduleAutoRefresh);
refreshSeconds.addEventListener("change", scheduleAutoRefresh);

/* Init */
(async function init(){
  await refresh();
  scheduleAutoRefresh();
})();
