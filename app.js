const listings = [
  {id:1,title:'دنا پلاس توربو اتوماتیک',model:'dena',city:'tehran',year:1402,mileage:18,price:1465,market:1610,score:82,discount:9,posted:'۴ دقیقه پیش',sample:38,transmission:'automatic',condition:'zero',image:'https://images.unsplash.com/photo-1492144534655-ae79c964c9d7?auto=format&fit=crop&w=900&q=82',tone:'hot'},
  {id:2,title:'فیدلیتی پرایم ۷ نفره',model:'fidelity',city:'tehran',year:1402,mileage:26,price:2110,market:2305,score:79,discount:8.5,posted:'۹ دقیقه پیش',sample:23,transmission:'automatic',condition:'zero',image:'https://images.unsplash.com/photo-1503376780353-7e6692767b70?auto=format&fit=crop&w=900&q=82',tone:'hot'},
  {id:3,title:'تارا اتوماتیک V4',model:'tara',city:'karaj',year:1403,mileage:4,price:1015,market:1090,score:76,discount:7,posted:'۱۲ دقیقه پیش',sample:42,transmission:'automatic',condition:'zero',image:'https://images.unsplash.com/photo-1494976388531-d1058494cdd8?auto=format&fit=crop&w=900&q=82',tone:'hot'},
  {id:4,title:'دیگنیتی پرستیژ',model:'dignity',city:'tehran',year:1402,mileage:14,price:2550,market:2710,score:73,discount:6,posted:'۱۹ دقیقه پیش',sample:17,transmission:'automatic',condition:'zero',image:'https://images.unsplash.com/photo-1552519507-da3b142c6e3d?auto=format&fit=crop&w=900&q=82',tone:'hot'},
  {id:5,title:'پژو ۲۰۷ پانوراما اتوماتیک',model:'207',city:'mashhad',year:1402,mileage:33,price:845,market:890,score:69,discount:5,posted:'۲۶ دقیقه پیش',sample:56,transmission:'automatic',condition:'zero',image:'https://images.unsplash.com/photo-1504215680853-026ed2a45def?auto=format&fit=crop&w=900&q=82',tone:'watch'},
  {id:6,title:'هایما S7 پلاس توربو',model:'haima',city:'tehran',year:1401,mileage:48,price:1685,market:1760,score:66,discount:4.3,posted:'۳۴ دقیقه پیش',sample:31,transmission:'automatic',condition:'zero',image:'https://images.unsplash.com/photo-1542282088-72c9c27ed0cd?auto=format&fit=crop&w=900&q=82',tone:'watch'},
  {id:7,title:'دنا پلاس توربو اتوماتیک',model:'dena',city:'karaj',year:1401,mileage:42,price:1260,market:1305,score:63,discount:3.5,posted:'۴۱ دقیقه پیش',sample:35,transmission:'automatic',condition:'zero',image:'https://images.unsplash.com/photo-1493238792000-8113da705763?auto=format&fit=crop&w=900&q=82',tone:'watch'},
  {id:8,title:'تارا دستی V1 پلاس',model:'tara',city:'tehran',year:1402,mileage:29,price:725,market:748,score:60,discount:3,posted:'۵۳ دقیقه پیش',sample:47,transmission:'manual',condition:'zero',image:'https://images.unsplash.com/photo-1533473359331-0135ef1b58bf?auto=format&fit=crop&w=900&q=82',tone:'watch'},
  {id:9,title:'پژو ۲۰۷ دنده‌ای پانوراما',model:'207',city:'karaj',year:1403,mileage:9,price:765,market:785,score:58,discount:2.5,posted:'۱ ساعت پیش',sample:61,transmission:'manual',condition:'zero',image:'https://images.unsplash.com/photo-1511919884226-fd3cad34687c?auto=format&fit=crop&w=900&q=82',tone:'watch'},
  {id:10,title:'فیدلیتی پرایم ۵ نفره',model:'fidelity',city:'mashhad',year:1401,mileage:51,price:1940,market:1980,score:55,discount:2,posted:'۱ ساعت پیش',sample:25,transmission:'automatic',condition:'zero',image:'https://images.unsplash.com/photo-1532581140115-3e355d1ed1de?auto=format&fit=crop&w=900&q=82',tone:'watch'},
  {id:11,title:'هایما S5 اتوماتیک',model:'haima',city:'tehran',year:1400,mileage:75,price:1250,market:1270,score:53,discount:1.6,posted:'۲ ساعت پیش',sample:28,transmission:'automatic',condition:'zero',image:'https://images.unsplash.com/photo-1549399542-7e3f8b79c341?auto=format&fit=crop&w=900&q=82',tone:'watch'},
  {id:12,title:'دیگنیتی پرایم',model:'dignity',city:'tehran',year:1401,mileage:56,price:2040,market:2065,score:51,discount:1.2,posted:'۲ ساعت پیش',sample:20,transmission:'automatic',condition:'zero',image:'https://images.unsplash.com/photo-1549317661-bd32c8ce0db2?auto=format&fit=crop&w=900&q=82',tone:'watch'}
];

const state = { sort: 'score', freeLimit: 8, unlocked: false, filtered: [...listings] };
const grid = document.getElementById('listing-grid');
const resultCount = document.getElementById('result-count');
const lockedMessage = document.getElementById('locked-message');
const emptyState = document.getElementById('empty-state');
const moreButton = document.getElementById('more-button');
const modalBackdrop = document.getElementById('modal-backdrop');
const modalContent = document.getElementById('modal-content');
const toast = document.getElementById('toast');
let toastTimer;

function fa(value) {
  return String(value).replace(/\d/g, d => '۰۱۲۳۴۵۶۷۸۹'[d]);
}
function formatMoney(value) { return fa(value.toLocaleString('en-US')); }
function cityName(value) { return {tehran:'تهران',karaj:'کرج',mashhad:'مشهد',isfahan:'اصفهان',shiraz:'شیراز'}[value] || value; }
function scoreName(score) { if (score >= 75) return 'فرصت خوب'; if (score >= 65) return 'خوش‌قیمت'; return 'نزدیک بازار'; }
function listingCard(item, index) {
  const isLocked = !state.unlocked && index >= state.freeLimit;
  const saved = JSON.parse(localStorage.getItem('khodroto-saved') || '[]').includes(item.id);
  return `<article class="listing-card ${isLocked ? 'locked' : ''}" data-id="${item.id}">
    <div class="listing-image" style="background-image:url('${item.image}')">
      <div class="score-badge ${item.tone}"><b>${fa(item.score)}</b><small>امتیاز</small></div>
      <button class="save-button ${saved ? 'saved' : ''}" data-save="${item.id}" aria-label="${saved ? 'حذف از ذخیره‌ها' : 'ذخیرهٔ آگهی'}">${saved ? '♥' : '♡'}</button>
    </div>
    <div class="listing-copy">
      <h3 class="listing-title">${item.title}</h3>
      <p class="listing-specs">مدل ${fa(item.year)} · ${formatMoney(item.mileage * 1000)} کیلومتر · ${cityName(item.city)}</p>
      <div class="price-row"><strong>${formatMoney(item.price)} <small>میلیون تومان</small></strong><span class="discount">${fa(item.discount)}٪ پایین‌تر</span></div>
      <div class="comparison"><span>میانهٔ مشابه‌ها</span><b>${formatMoney(item.market)} میلیون</b></div>
      <div class="listing-meta"><span><i></i>${item.posted}</span><button class="card-details" data-details="${item.id}">جزئیات ←</button></div>
    </div>
  </article>`;
}
function sortItems(items) {
  const results = [...items];
  if (state.sort === 'newest') return results.sort((a,b) => a.id - b.id);
  if (state.sort === 'price') return results.sort((a,b) => a.price - b.price);
  return results.sort((a,b) => b.score - a.score);
}
function renderListings() {
  const items = sortItems(state.filtered);
  resultCount.textContent = `${fa(items.length)} فرصت`;
  grid.innerHTML = items.map(listingCard).join('');
  const hasLocked = !state.unlocked && items.length > state.freeLimit;
  lockedMessage.hidden = !hasLocked;
  moreButton.hidden = !hasLocked;
  emptyState.hidden = items.length !== 0;
  grid.hidden = items.length === 0;
}
function toastMessage(message) {
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 3300);
}
function openModal(type, payload) {
  let html = '';
  let wide = false;
  if (type === 'login') {
    html = `<h2 id="modal-title">ورود به خودروتو</h2><p class="modal-lead">شماره‌ات را وارد کن تا ذخیره‌ها و دنبال‌کردن مدل‌ها روی همهٔ دستگاه‌ها در دسترست باشد.</p><form data-form="login"><label>شمارهٔ موبایل<input class="modal-input" type="tel" inputmode="numeric" placeholder="۰۹۱۲ ۱۲۳ ۴۵۶۷" required></label><button class="button button-primary full" type="submit">ادامه <span>←</span></button></form><p class="modal-form-note">در این نسخهٔ نمایشی، پیامکی ارسال نمی‌شود.</p>`;
  } else if (type === 'pro') {
    html = `<h2 id="modal-title">همهٔ فرصت‌ها را ببین</h2><p class="modal-lead">در نسخهٔ اصلی، خودروتو پلاس نتایج کامل، موارد نیازمند بررسی و روند قیمت مدل‌های منتخب را باز می‌کند.</p><div class="method-modal"><div class="method-stat"><strong>۱۲</strong><span>فرصت در نتیجهٔ فعلی پیدا شده؛<br>۴ موردِ بعدی با پلاس باز می‌شوند.</span></div></div><button class="button button-primary full" data-unlock>فعال‌سازی نمایشی <span>←</span></button><p class="modal-form-note">این دکمه فقط برای بررسی تجربهٔ دموست و پرداختی انجام نمی‌شود.</p>`;
  } else if (type === 'method') {
    html = `<div class="method-modal"><span class="section-kicker">روش امتیازدهی</span><h2 id="modal-title">قیمتِ منصفانه را به فرصت تبدیل می‌کنیم.</h2><p class="modal-lead">مدل، سال، کارکرد و شهر را به‌صورت هم‌زمان مقایسه می‌کنیم تا عددی قابل‌فهم از وضعیت قیمت داشته باشی.</p><div class="method-stat"><strong>۸۲</strong><span>یعنی این آگهی، حدود ۹٪ پایین‌تر از میانهٔ نمونه‌های هم‌رده است؛ پس در دستهٔ «فرصت خوب» قرار می‌گیرد.</span></div><p class="modal-form-note">امتیازِ قیمت جای کارشناسی خودرو یا بررسی حقوقی را نمی‌گیرد.</p></div>`;
  } else if (type === 'watchlist') {
    html = `<h2 id="modal-title">یک مدل را زیر نظر بگیر</h2><p class="modal-lead">وقتی فرصت تازه یا نوسان مهمی ثبت شد، در نسخهٔ اصلی به تو خبر می‌دهیم.</p><form data-form="watch"><label>مدل مورد علاقه<select class="modal-input"><option>دنا پلاس اتوماتیک</option><option>تارا اتوماتیک</option><option>دیگنیتی پرایم</option><option>پژو ۲۰۷ پانوراما</option></select></label><label>شمارهٔ موبایل<input class="modal-input" type="tel" inputmode="numeric" placeholder="۰۹۱۲ ۱۲۳ ۴۵۶۷" required></label><button class="button button-primary full" type="submit">ثبت در فهرست انتظار</button></form>`;
  } else if (type === 'feedback') {
    html = `<h2 id="modal-title">بازخوردِ نسخهٔ نمایشی</h2><p class="modal-lead">بگو در تجربهٔ خودروتو چه چیزی برایت مهم‌تر است یا کجا به مشکل خوردی.</p><form data-form="feedback"><label>پیامت<textarea class="modal-input" rows="4" placeholder="مثلاً فیلتر مدل‌های خارجی هم اضافه شود..." required></textarea></label><button class="button button-primary full" type="submit">ثبت بازخورد</button></form>`;
  } else if (type === 'listing') {
    const item = listings.find(x => x.id === Number(payload));
    if (!item) return;
    wide = true;
    html = `<div class="ad-modal-top"><div class="ad-modal-image" style="background-image:url('${item.image}')"></div><div><span class="section-kicker">تحلیل آگهی</span><h2 id="modal-title">${item.title}</h2><p>مدل ${fa(item.year)} · ${formatMoney(item.mileage * 1000)} کیلومتر · ${cityName(item.city)}</p></div></div><div class="price-analysis"><div><span>قیمت آگهی</span><b>${formatMoney(item.price)} م.ت</b></div><div><span>میانهٔ بازار</span><b>${formatMoney(item.market)} م.ت</b></div><div><span>اختلاف</span><b>${fa(item.discount)}٪ پایین‌تر</b></div></div><div class="method-stat"><strong>${fa(item.score)}</strong><span>امتیاز فرصت<br><b>${scoreName(item.score)}</b> با مقایسهٔ ${fa(item.sample)} آگهی مشابه</span></div><p class="ad-note">این امتیاز فقط به قیمت مربوط است. پیش از هر تصمیم، سلامت فنی، بدنه و اصالت مدارک خودرو را بررسی کن.</p><button class="button button-dark full" data-toast="در نسخهٔ محصول، لینک مستقیم به آگهیِ منبع اینجا نمایش داده می‌شود.">مشاهدهٔ آگهیِ منبع <span>↗</span></button>`;
  }
  modalContent.innerHTML = html;
  // Use an explicit state class as well as `hidden` so the modal is never left
  // visible by a component display rule or a browser cache edge case.
  modalBackdrop.hidden = false;
  modalBackdrop.classList.add('is-open');
  modalBackdrop.setAttribute('aria-hidden', 'false');
  modalBackdrop.querySelector('.modal').classList.toggle('wide', wide);
  document.body.classList.add('modal-open');
  const firstInput = modalContent.querySelector('input, textarea, select');
  if (firstInput) setTimeout(() => firstInput.focus(), 50);
}
function closeModal() {
  modalBackdrop.classList.remove('is-open');
  modalBackdrop.hidden = true;
  modalBackdrop.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('modal-open');
  modalContent.innerHTML = '';
}
function applyFilters() {
  const city = document.getElementById('city').value;
  const model = document.getElementById('model').value;
  const budget = Number(document.getElementById('budget').value);
  const year = Number(document.getElementById('year').value);
  const mileage = Number(document.getElementById('mileage').value);
  state.filtered = listings.filter(item =>
    (city === 'all' || item.city === city) &&
    (model === 'all' || item.model === model) &&
    (!budget || item.price <= budget) &&
    (!year || item.year >= year) &&
    (!mileage || item.mileage <= mileage)
  );
  renderListings();
}

renderListings();
document.getElementById('filter-form').addEventListener('submit', event => { event.preventDefault(); applyFilters(); document.getElementById('opportunities').scrollIntoView({behavior:'smooth', block:'start'}); });
document.getElementById('reset-filters').addEventListener('click', () => { document.getElementById('filter-form').reset(); applyFilters(); });

// Anchor-like controls used throughout the landing page.
document.addEventListener('click', event => {
  const scroll = event.target.closest('[data-scroll]');
  if (scroll) { const target = document.getElementById(scroll.dataset.scroll); if (target) target.scrollIntoView({behavior:'smooth', block:'start'}); }
  const modal = event.target.closest('[data-modal]');
  if (modal) openModal(modal.dataset.modal);
  const detail = event.target.closest('[data-details]');
  if (detail) openModal('listing', detail.dataset.details);
  const save = event.target.closest('[data-save]');
  if (save) {
    const id = Number(save.dataset.save); const saved = JSON.parse(localStorage.getItem('khodroto-saved') || '[]'); const index = saved.indexOf(id);
    if (index > -1) { saved.splice(index, 1); toastMessage('از آگهی‌های ذخیره‌شده حذف شد.'); } else { saved.push(id); toastMessage('آگهی ذخیره شد.'); }
    localStorage.setItem('khodroto-saved', JSON.stringify(saved)); renderListings();
  }
  const toastButton = event.target.closest('[data-toast]');
  if (toastButton) toastMessage(toastButton.dataset.toast);
  if (event.target.closest('[data-unlock]')) { state.unlocked = true; renderListings(); closeModal(); toastMessage('همهٔ فرصت‌های این دمو برای بررسی باز شدند.'); }
  if (event.target.closest('#more-button')) openModal('pro');
  if (event.target.closest('.modal-close') || event.target === modalBackdrop) closeModal();
  if (event.target.closest('#sort-button')) { document.getElementById('sort-menu').classList.toggle('open'); }
  const sort = event.target.closest('[data-sort]');
  if (sort) { state.sort = sort.dataset.sort; document.getElementById('sort-menu').classList.remove('open'); document.getElementById('sort-button').innerHTML = `${sort.textContent} <span>⌄</span>`; renderListings(); }
  const quick = event.target.closest('[data-quick]');
  if (quick) {
    document.querySelectorAll('[data-quick]').forEach(b => b.classList.remove('active'));
    quick.classList.add('active');
    const type = quick.dataset.quick;
    if (type === 'automatic') state.filtered = listings.filter(x => x.transmission === 'automatic');
    if (type === 'zero') state.filtered = listings.filter(x => x.condition === 'zero');
    if (type === 'lowMileage') state.filtered = listings.filter(x => x.mileage <= 30);
    if (type === 'newest') state.filtered = listings.filter(x => x.year >= 1402);
    renderListings(); document.getElementById('opportunities').scrollIntoView({behavior:'smooth', block:'start'});
  }
});

modalContent.addEventListener('submit', event => { if (!event.target.matches('form')) return; event.preventDefault(); const kind = event.target.dataset.form; closeModal(); toastMessage(kind === 'feedback' ? 'بازخوردت برای بررسی ثبت شد؛ ممنون!' : kind === 'watch' ? 'در فهرست انتظار ثبت شد. در نسخهٔ اصلی اطلاع می‌دهیم.' : 'ورود نمایشی با موفقیت انجام شد.'); });
// Keep the close control local to the overlay as well as in the delegated page handler.
// This makes the × and backdrop reliable on both desktop and touch previews.
modalBackdrop.addEventListener('click', event => {
  if (event.target === modalBackdrop || event.target.closest('.modal-close')) closeModal();
});
document.addEventListener('keydown', event => { if (event.key === 'Escape' && !modalBackdrop.hidden) closeModal(); });

const menuButton = document.querySelector('.menu-button');
const mobileMenu = document.querySelector('.mobile-menu');
menuButton.addEventListener('click', () => { const open = mobileMenu.classList.toggle('open'); menuButton.setAttribute('aria-expanded', String(open)); mobileMenu.setAttribute('aria-hidden', String(!open)); });
mobileMenu.addEventListener('click', event => { if (event.target.matches('a')) { mobileMenu.classList.remove('open'); menuButton.setAttribute('aria-expanded','false'); mobileMenu.setAttribute('aria-hidden','true'); } });
