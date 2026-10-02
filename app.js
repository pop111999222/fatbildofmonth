const STORAGE_KEY = 'monthly-balance-helper-v1';
const DEFAULT_RENT = 18000;
const CATEGORIES = ['分期', '加油', '餐費', '自動加值', '電話費', '雜費', '交通費', '回饋金', '待確認'];
const BANK_NAMES = { yuanta: '元大信用卡', fubon: '台北富邦信用卡' };
const today = new Date();
const initialMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;

const $ = (selector) => document.querySelector(selector);
const money = (value) => `NT$ ${Math.round(Number(value) || 0).toLocaleString('zh-TW')}`;
const monthLabel = (month) => {
  const [year, monthNumber] = month.split('-');
  return `${year} 年 ${Number(monthNumber)} 月`;
};
const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const numberValue = (value) => Math.round(Number(value) || 0);

let state = loadState();
let parsedImport = null;

function freshMonth(month = initialMonth) {
  return {
    month,
    salary: 0,
    sideIncome: 0,
    rent: state.settings?.rentDefault ?? DEFAULT_RENT,
    cards: {
      yuanta: { statementAmount: null, status: 'pending', detailTotal: 0, sourceNote: '' },
      fubon: { statementAmount: null, status: 'pending', detailTotal: 0, sourceNote: '' }
    },
    transactions: [],
    notes: '',
    updatedAt: new Date().toISOString()
  };
}

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved?.months) return { settings: { rentDefault: DEFAULT_RENT, ...saved.settings }, activeMonth: saved.activeMonth || initialMonth, months: saved.months };
  } catch (error) { console.warn('本機資料讀取失敗，將使用空白資料。', error); }
  return { settings: { rentDefault: DEFAULT_RENT }, activeMonth: initialMonth, months: { [initialMonth]: freshMonthFallback(initialMonth) } };
}

function freshMonthFallback(month) {
  return { month, salary: 0, sideIncome: 0, rent: DEFAULT_RENT, cards: { yuanta: { statementAmount: null, status: 'pending', detailTotal: 0, sourceNote: '' }, fubon: { statementAmount: null, status: 'pending', detailTotal: 0, sourceNote: '' } }, transactions: [], notes: '', updatedAt: new Date().toISOString() };
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function currentMonth() {
  if (!state.months[state.activeMonth]) state.months[state.activeMonth] = freshMonth(state.activeMonth);
  const data = state.months[state.activeMonth];
  data.cards ||= {};
  for (const bank of ['yuanta', 'fubon']) data.cards[bank] ||= { statementAmount: null, status: 'pending', detailTotal: 0, sourceNote: '' };
  data.transactions ||= [];
  return data;
}

function cardAmount(month, bank) { return numberValue(month.cards?.[bank]?.statementAmount); }
function detailTotal(month, bank) { return month.transactions.filter((item) => item.bank === bank && item.status !== 'ignored').reduce((total, item) => total + numberValue(item.amount), 0); }
function cardDifference(month, bank) { const card = month.cards?.[bank]; return card?.statementAmount == null ? null : cardAmount(month, bank) - detailTotal(month, bank); }
function monthlyTotals(month) {
  const income = numberValue(month.salary) + numberValue(month.sideIncome);
  const cards = cardAmount(month, 'yuanta') + cardAmount(month, 'fubon');
  return { income, rent: numberValue(month.rent), cards, balance: income - numberValue(month.rent) - cards };
}

function render() {
  const month = currentMonth();
  $('#active-month').value = state.activeMonth;
  $('#salary').value = month.salary || '';
  $('#side-income').value = month.sideIncome || '';
  $('#rent').value = month.rent || '';
  $('#month-notes').value = month.notes || '';
  const totals = monthlyTotals(month);
  $('#summary-balance').textContent = money(totals.balance);
  $('#summary-income').textContent = money(totals.income);
  $('#summary-fixed').textContent = money(totals.rent);
  $('#summary-cards').textContent = money(totals.cards);
  $('#summary-balance-meta').textContent = totals.balance >= 0 ? '本月還有可運用餘額' : '本月支出已超過收入';
  $('#summary-card-meta').textContent = `${month.cards.yuanta.status === 'confirmed' && month.cards.fubon.status === 'confirmed' ? '兩家帳單已完成對帳' : '元大＋富邦'}`;
  renderCards(month);
  renderCategories(month);
  renderPending(month);
  renderTransactions(month);
  renderAnnual();
}

function renderCards(month) {
  for (const bank of ['yuanta', 'fubon']) {
    const card = month.cards[bank];
    const amount = card.statementAmount == null ? '—' : money(card.statementAmount);
    const difference = cardDifference(month, bank);
    let status = card.statementAmount == null ? '尚未匯入' : card.status === 'confirmed' ? '已完成對帳' : '待確認本期應繳總額';
    if (card.statementAmount != null && difference !== 0 && card.status === 'confirmed') status = `明細差額 ${money(difference)}`;
    $(`#${bank}-amount`).textContent = amount;
    $(`#${bank}-status`).textContent = status;
  }
  const differences = ['yuanta', 'fubon'].map((bank) => cardDifference(month, bank)).filter((value) => value !== null);
  const difference = differences.reduce((sum, value) => sum + value, 0);
  $('#reconcile-difference').textContent = money(difference);
  const alert = $('#reconcile-alert');
  const pendingCards = ['yuanta', 'fubon'].filter((bank) => month.cards[bank].statementAmount == null || month.cards[bank].status !== 'confirmed');
  alert.className = `alert-box ${difference !== 0 && differences.length ? 'danger' : pendingCards.length ? 'warning' : 'success'}`;
  alert.innerHTML = difference !== 0 && differences.length
    ? `<span>!</span><p>明細與帳單仍有 ${money(Math.abs(difference))} 差額，請檢查分期、回饋或跨頁項目。</p>`
    : pendingCards.length
      ? `<span>◌</span><p>${pendingCards.map((bank) => BANK_NAMES[bank]).join('、')} 尚未完成帳單確認。</p>`
      : '<span>✓</span><p>兩家信用卡明細與本期應繳金額一致。</p>';
}

function renderCategories(month) {
  const active = month.transactions.filter((item) => item.status !== 'ignored');
  const sums = active.reduce((result, item) => { const category = item.category || '待確認'; result[category] = (result[category] || 0) + numberValue(item.amount); return result; }, {});
  const entries = Object.entries(sums).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
  $('#category-total').textContent = `${active.length} 筆`;
  $('#category-list').innerHTML = entries.length ? entries.slice(0, 8).map(([category, amount], index) => {
    const max = Math.max(...entries.map((entry) => Math.abs(entry[1])), 1);
    return `<div class="category-row"><span>${category}</span><div class="category-bar"><span style="width:${Math.max(5, Math.round(Math.abs(amount) / max * 100))}%"></span></div><strong>${money(amount)}</strong></div>`;
  }).join('') : '<div class="empty-state compact">匯入或新增交易後，這裡會顯示分類統計。</div>';
}

function renderPending(month) {
  const pending = month.transactions.filter((item) => item.status !== 'ignored' && item.category === '待確認');
  $('#pending-count').textContent = pending.length;
  $('#pending-list').innerHTML = pending.length ? pending.slice(0, 4).map((item) => `<div class="pending-item"><span class="pending-dot"></span><span>${escapeHtml(item.merchant)}</span><strong>${money(item.amount)}</strong></div>`).join('') : '<div class="empty-state compact">目前沒有待確認項目。</div>';
}

function renderTransactions(month) {
  const body = $('#transactions-body');
  const items = month.transactions;
  $('#transactions-empty').style.display = items.length ? 'none' : 'block';
  body.innerHTML = items.map((item) => `<tr class="${item.status === 'ignored' ? 'hidden-row' : ''}">
    <td>${item.date || '—'}</td><td>${item.bank === 'yuanta' ? '元大' : '富邦'}</td><td>${escapeHtml(item.merchant)}</td>
    <td class="${numberValue(item.amount) < 0 ? 'amount-negative' : 'amount-positive'}">${money(item.amount)}</td>
    <td><select class="category-select ${item.category === '待確認' ? 'pending' : ''}" data-action="category" data-id="${item.id}">${CATEGORIES.map((category) => `<option ${category === item.category ? 'selected' : ''}>${category}</option>`).join('')}</select></td>
    <td><span class="status-pill ${item.category === '待確認' ? 'pending' : 'confirmed'}">${item.category === '待確認' ? '待確認' : item.status === 'ignored' ? '已忽略' : '已分類'}</span></td>
    <td><div class="row-actions"><button class="mini-button" data-action="edit" data-id="${item.id}" title="編輯">✎</button><button class="mini-button" data-action="delete" data-id="${item.id}" title="刪除">×</button></div></td>
  </tr>`).join('');
}

function renderAnnual() {
  const year = state.activeMonth.slice(0, 4);
  const rows = Array.from({ length: 12 }, (_, index) => `${year}-${String(index + 1).padStart(2, '0')}`).map((monthKey) => state.months[monthKey] || freshMonth(monthKey));
  const totals = rows.reduce((result, month) => { const summary = monthlyTotals(month); result.income += summary.income; result.rent += summary.rent; result.cards += summary.cards; result.balance += summary.balance; result.pending += month.transactions.filter((item) => item.category === '待確認').length; return result; }, { income: 0, rent: 0, cards: 0, balance: 0, pending: 0 });
  $('#annual-title').textContent = `${year} 年度總覽`; $('#annual-balance').textContent = money(totals.balance); $('#annual-income').textContent = money(totals.income); $('#annual-rent').textContent = money(totals.rent); $('#annual-cards').textContent = money(totals.cards); $('#annual-pending').textContent = totals.pending;
  $('#annual-body').innerHTML = rows.map((month) => { const summary = monthlyTotals(month); const pending = month.transactions.filter((item) => item.category === '待確認').length; const cardPending = ['yuanta', 'fubon'].some((bank) => month.cards[bank]?.statementAmount == null || month.cards[bank]?.status !== 'confirmed'); return `<tr><td>${monthLabel(month.month)}</td><td>${money(summary.income)}</td><td>${money(summary.rent)}</td><td>${month.cards.yuanta?.statementAmount == null ? '—' : money(month.cards.yuanta.statementAmount)}</td><td>${month.cards.fubon?.statementAmount == null ? '—' : money(month.cards.fubon.statementAmount)}</td><td><strong>${money(summary.balance)}</strong></td><td>${pending ? `${pending} 筆待確認` : cardPending ? '帳單待確認' : '—'}</td></tr>`; }).join('');
}

function escapeHtml(value) { return String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char])); }
function showToast(message) { const toast = $('#toast'); toast.textContent = message; toast.classList.add('show'); clearTimeout(showToast.timer); showToast.timer = setTimeout(() => toast.classList.remove('show'), 2600); }
function markChanged() { $('#saved-status').textContent = '有尚未儲存的變更'; $('#saved-status').classList.remove('saved'); }

function updateMonthFromForm() {
  const month = currentMonth(); month.salary = numberValue($('#salary').value); month.sideIncome = numberValue($('#side-income').value); month.rent = numberValue($('#rent').value); month.notes = $('#month-notes').value.trim(); month.updatedAt = new Date().toISOString(); state.settings.rentDefault = month.rent; saveState(); $('#saved-status').textContent = '已儲存於本機'; $('#saved-status').classList.add('saved'); showToast('本月資料已儲存'); render();
}

function openTransactionDialog(item = null) {
  $('#editing-transaction-id').value = item?.id || ''; $('#transaction-dialog-title').textContent = item ? '編輯交易' : '新增交易'; $('#transaction-date').value = item?.date || `${state.activeMonth}-01`; $('#transaction-bank').value = item?.bank || 'yuanta'; $('#transaction-merchant').value = item?.merchant || ''; $('#transaction-amount').value = item?.amount ?? ''; $('#transaction-category').innerHTML = CATEGORIES.map((category) => `<option>${category}</option>`).join(''); $('#transaction-category').value = item?.category || '待確認'; $('#transaction-dialog').showModal();
}

function saveTransactionFromDialog() {
  const month = currentMonth(); const id = $('#editing-transaction-id').value; const existing = month.transactions.find((item) => item.id === id); const transaction = { id: id || uid(), month: state.activeMonth, date: $('#transaction-date').value, bank: $('#transaction-bank').value, merchant: $('#transaction-merchant').value.trim(), amount: numberValue($('#transaction-amount').value), currency: 'TWD', category: $('#transaction-category').value, status: 'active', sourcePage: null, sourceText: '', userEdited: true };
  if (existing) Object.assign(existing, transaction); else month.transactions.unshift(transaction); saveState(); $('#transaction-dialog').close(); render(); showToast('交易已儲存');
}

function suggestCategory(text) {
  const value = text.toLowerCase();
  if (/分期|利息|installment/.test(value)) return '分期'; if (/加油|汽油|柴油|中油|台塑/.test(value)) return '加油'; if (/餐|食|餐廳|外送|咖啡|飲料|food|cafe/.test(value)) return '餐費'; if (/一卡通|悠遊卡|自動加值|加值/.test(value)) return '自動加值'; if (/遠傳|電信|電話|行動/.test(value)) return '電話費'; if (/uber|計程車|捷運|高鐵|交通|taxi|車隊/.test(value)) return '交通費'; if (/回饋|折抵|紅利/.test(value)) return '回饋金'; return '待確認';
}

function parseStatementText(text, bank, month) {
  const normalized = text.replace(/\u00a0/g, ' ').replace(/,/g, ''); const amountPatterns = [/本期應繳(?:總額|金額)?[^\d-]*(-?\d+(?:\.\d+)?)/, /應繳(?:總額|金額)[^\d-]*(-?\d+(?:\.\d+)?)/]; let statementAmount = null; for (const pattern of amountPatterns) { const match = normalized.match(pattern); if (match) { statementAmount = numberValue(match[1]); break; } }
  const lines = normalized.split(/\r?\n/).map((line) => line.trim()).filter(Boolean); const transactions = []; const datePattern = /(\d{4}[/-]\d{1,2}[/-]\d{1,2}|\d{1,2}[/-]\d{1,2})/;
  for (const line of lines) { if (/本期應繳|應繳總額|前期帳款|已繳款|消費加總|紅利|頁次|繳款期限|卡號|總計/.test(line)) continue; const dateMatch = line.match(datePattern); const amountMatches = [...line.matchAll(/(-?\d{1,3}(?:,?\d{3})*(?:\.\d+)?)(?=\s*$|\s+\D*$)/g)]; if (!amountMatches.length || !dateMatch) continue; const amount = numberValue(amountMatches[amountMatches.length - 1][1]); if (!amount || Math.abs(amount) > 1000000) continue; const merchant = line.replace(dateMatch[0], '').replace(amountMatches[amountMatches.length - 1][0], '').replace(/[|｜]/g, ' ').trim(); if (!merchant || merchant.length < 2) continue; const rawDate = dateMatch[1].replace(/-/g, '/'); const date = rawDate.length <= 5 ? `${month.slice(0, 4)}/${rawDate}` : rawDate.replace(/\//g, '-'); transactions.push({ id: uid(), month, date, bank, merchant, amount, currency: 'TWD', originalAmount: null, category: suggestCategory(merchant), isInstallment: /分期|期/.test(merchant), installmentInfo: null, sourcePage: null, sourceText: line, status: 'active', userEdited: false }); }
  return { statementAmount, transactions, rawTextLength: text.length };
}

let ocrModulePromise = null;
let previewObjectUrl = null;

async function loadOcrModule() {
  if (window.Tesseract) return window.Tesseract;
  if (!ocrModulePromise) ocrModulePromise = import('https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.esm.min.js');
  return ocrModulePromise;
}

async function extractImageText(file, onProgress) {
  const { createWorker } = await loadOcrModule();
  const worker = await createWorker('chi_tra+eng', 1, { logger: (message) => onProgress?.(message) });
  try {
    const result = await worker.recognize(file);
    return result.data.text;
  } finally {
    await worker.terminate();
  }
}

async function extractPdfText(file, onProgress) {
  if (file.type === 'text/plain' || file.name.toLowerCase().endsWith('.txt')) return file.text();
  if (file.type.startsWith('image/') || /\.(png|jpe?g|webp)$/i.test(file.name)) return extractImageText(file, onProgress);
  if (!window.pdfjsLib) throw new Error('PDF 解析器尚未載入，請稍候再試，或手動輸入本期應繳金額。');
  const buffer = await file.arrayBuffer(); const pdf = await window.pdfjsLib.getDocument({ data: buffer }).promise; let text = ''; for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) { const page = await pdf.getPage(pageNumber); const content = await page.getTextContent(); text += `${content.items.map((item) => item.str).join(' ')}\n`; } return text;
}

function isImageFile(file) { return Boolean(file && (file.type.startsWith('image/') || /\.(png|jpe?g|webp)$/i.test(file.name))); }

async function previewImport(file) {
  const preview = $('#import-preview');
  if (previewObjectUrl) { URL.revokeObjectURL(previewObjectUrl); previewObjectUrl = null; }
  if (!file) { preview.className = 'import-preview'; preview.innerHTML = '<span class="preview-icon">↥</span><strong>尚未選擇檔案</strong><p>支援 PDF、PNG、JPG、WEBP；截圖會在本機 OCR，不會上傳圖片。</p>'; parsedImport = null; return; }
  let objectUrl = null;
  if (isImageFile(file)) { objectUrl = URL.createObjectURL(file); previewObjectUrl = objectUrl; preview.className = 'import-preview has-image'; preview.innerHTML = `<img src="${objectUrl}" alt="帳單截圖預覽"><strong>正在辨識 ${escapeHtml(file.name)}</strong><div class="ocr-progress"><span></span></div><p>OCR 會在本機進行，圖片不會上傳。</p>`; } else { preview.className = 'import-preview'; preview.innerHTML = `<span class="preview-icon">…</span><strong>正在讀取 ${escapeHtml(file.name)}</strong><p>只在本機解析，不會上傳檔案。</p>`; }
  try {
    const text = await extractPdfText(file, (message) => { if (isImageFile(file) && message.status) { const label = message.status === 'recognizing text' ? `OCR 辨識中 ${Math.round((message.progress || 0) * 100)}%` : '正在準備 OCR…'; const strong = preview.querySelector('strong'); if (strong) strong.textContent = label; } });
    parsedImport = { ...parseStatementText(text, $('#import-bank').value, state.activeMonth), sourceType: isImageFile(file) ? 'image' : 'pdf' };
    const imageMarkup = isImageFile(file) ? `<img src="${objectUrl}" alt="帳單截圖預覽">` : '<span class="preview-icon">✓</span>';
    preview.className = `import-preview${isImageFile(file) ? ' has-image' : ''}`;
    preview.innerHTML = `${imageMarkup}<strong>${escapeHtml(file.name)} 已讀取</strong><p class="ocr-complete">找到 ${parsedImport.transactions.length} 筆可能的明細${parsedImport.statementAmount == null ? '；未找到本期應繳金額，請手動補上。' : `；本期應繳 ${money(parsedImport.statementAmount)}。`}</p>`;
    if (parsedImport.statementAmount != null) $('#import-statement-amount').value = parsedImport.statementAmount;
  } catch (error) {
    parsedImport = { statementAmount: null, transactions: [], error: error.message };
    const imageMarkup = isImageFile(file) ? `<img src="${objectUrl}" alt="帳單截圖預覽">` : '<span class="preview-icon">!</span>';
    preview.className = `import-preview${isImageFile(file) ? ' has-image' : ''}`;
    preview.innerHTML = `${imageMarkup}<strong>目前無法解析${isImageFile(file) ? '截圖' : '檔案'}</strong><p>${escapeHtml(error.message)} 可直接輸入本期應繳金額建立待確認帳單。</p>`;
  }
}

let cropObjectUrl = null;
let cropSelection = null;

function updateCropSelection(selectionElement, start, end, bounds) {
  const left = Math.max(0, Math.min(start.x, end.x)); const top = Math.max(0, Math.min(start.y, end.y)); const right = Math.min(bounds.width, Math.max(start.x, end.x)); const bottom = Math.min(bounds.height, Math.max(start.y, end.y));
  cropSelection = { left, top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
  selectionElement.style.left = `${left}px`; selectionElement.style.top = `${top}px`; selectionElement.style.width = `${cropSelection.width}px`; selectionElement.style.height = `${cropSelection.height}px`; selectionElement.classList.toggle('visible', cropSelection.width > 8 && cropSelection.height > 8); $('#crop-confirm').disabled = cropSelection.width <= 8 || cropSelection.height <= 8;
}

async function cropCapturedImage(file, imageElement) {
  if (!cropSelection || cropSelection.width <= 8 || cropSelection.height <= 8) return;
  const scaleX = imageElement.naturalWidth / imageElement.clientWidth; const scaleY = imageElement.naturalHeight / imageElement.clientHeight; const sourceX = Math.round(cropSelection.left * scaleX); const sourceY = Math.round(cropSelection.top * scaleY); const sourceWidth = Math.min(imageElement.naturalWidth - sourceX, Math.round(cropSelection.width * scaleX)); const sourceHeight = Math.min(imageElement.naturalHeight - sourceY, Math.round(cropSelection.height * scaleY));
  const canvas = document.createElement('canvas'); canvas.width = sourceWidth; canvas.height = sourceHeight; canvas.getContext('2d').drawImage(imageElement, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, sourceWidth, sourceHeight);
  const blob = await new Promise((resolve, reject) => canvas.toBlob((imageBlob) => imageBlob ? resolve(imageBlob) : reject(new Error('無法裁切截圖。')), 'image/png'));
  const croppedFile = new File([blob], `帳單截圖-選取-${new Date().toISOString().slice(0, 10)}.png`, { type: 'image/png' });
  if (cropObjectUrl) { URL.revokeObjectURL(cropObjectUrl); cropObjectUrl = null; }
  cropSelection = null; await previewImport(croppedFile); showToast('已完成裁切，正在進行本機 OCR');
}

function startCropSelection(file) {
  if (cropObjectUrl) URL.revokeObjectURL(cropObjectUrl); cropObjectUrl = URL.createObjectURL(file); cropSelection = null;
  const preview = $('#import-preview'); preview.className = 'import-preview crop-preview'; preview.innerHTML = `<div class="crop-tool"><img id="crop-source-image" src="${cropObjectUrl}" alt="待裁切的螢幕截圖" draggable="false"><div class="crop-shade"></div><div id="crop-selection" class="crop-selection"></div></div><div class="crop-help">拖曳滑鼠框選帳單區域，OCR 只會辨識框選內容。</div><div class="crop-actions"><button class="button outline" id="crop-reset" type="button">清除框選</button><button class="button primary" id="crop-confirm" type="button" disabled>裁切並辨識</button></div>`;
  const imageElement = $('#crop-source-image'); const selectionElement = $('#crop-selection'); imageElement.addEventListener('load', () => { cropSelection = null; });
  let dragging = false; let start = null;
  const pointFromEvent = (event) => { const bounds = imageElement.getBoundingClientRect(); return { x: Math.max(0, Math.min(bounds.width, event.clientX - bounds.left)), y: Math.max(0, Math.min(bounds.height, event.clientY - bounds.top)) }; };
  imageElement.addEventListener('pointerdown', (event) => { event.preventDefault(); dragging = true; start = pointFromEvent(event); imageElement.setPointerCapture(event.pointerId); updateCropSelection(selectionElement, start, start, imageElement.getBoundingClientRect()); });
  imageElement.addEventListener('pointermove', (event) => { if (!dragging) return; updateCropSelection(selectionElement, start, pointFromEvent(event), imageElement.getBoundingClientRect()); });
  imageElement.addEventListener('pointerup', (event) => { if (!dragging) return; dragging = false; updateCropSelection(selectionElement, start, pointFromEvent(event), imageElement.getBoundingClientRect()); imageElement.releasePointerCapture(event.pointerId); });
  $('#crop-reset').addEventListener('click', () => { cropSelection = null; selectionElement.classList.remove('visible'); $('#crop-confirm').disabled = true; });
  $('#crop-confirm').addEventListener('click', async () => { const button = $('#crop-confirm'); button.disabled = true; button.textContent = '正在裁切…'; try { await cropCapturedImage(file, imageElement); } catch (error) { button.disabled = false; button.textContent = '裁切並辨識'; showToast(error.message); } });
}

async function captureScreenshot() {
  if (!navigator.mediaDevices?.getDisplayMedia) { showToast('目前瀏覽器不支援直接擷取畫面，請改用檔案選取。'); return; }
  const captureButton = $('#capture-screenshot');
  captureButton.disabled = true;
  captureButton.innerHTML = '<span>…</span>等待選取畫面';
  let stream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({ video: { cursor: 'always' }, audio: false });
    const video = document.createElement('video'); video.srcObject = stream; video.muted = true; await video.play();
    await new Promise((resolve) => { if (video.videoWidth) resolve(); else video.addEventListener('loadedmetadata', resolve, { once: true }); });
    const canvas = document.createElement('canvas'); canvas.width = video.videoWidth; canvas.height = video.videoHeight; canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve, reject) => canvas.toBlob((imageBlob) => imageBlob ? resolve(imageBlob) : reject(new Error('無法產生截圖。')), 'image/png'));
    const file = new File([blob], `帳單截圖-${new Date().toISOString().slice(0, 10)}.png`, { type: 'image/png' });
    startCropSelection(file);
    showToast('畫面截圖已完成，請拖曳框選帳單區域');
  } catch (error) {
    if (error.name !== 'AbortError' && error.name !== 'NotAllowedError') showToast(`截圖失敗：${error.message}`);
  } finally {
    stream?.getTracks().forEach((track) => track.stop());
    captureButton.disabled = false; captureButton.innerHTML = '<span>▣</span>直接擷取目前畫面';
  }
}

function confirmImport() {
  const statementInput = $('#import-statement-amount').value; const statementAmount = statementInput === '' ? parsedImport?.statementAmount ?? null : numberValue(statementInput); const transactions = parsedImport?.transactions || [];
  if (!parsedImport) { showToast('請先完成截圖裁切或選擇帳單檔案。'); return; }
  if (parsedImport.error && statementInput === '' && transactions.length === 0) { showToast('OCR 沒有讀到可用資料，請重新框選，或手動輸入本期應繳金額。'); return; }
  if (statementAmount == null && transactions.length === 0) { showToast('目前沒有可匯入的金額或交易，請重新框選帳單內容。'); return; }
  const month = currentMonth(); const bank = $('#import-bank').value; const old = month.transactions.filter((item) => item.bank !== bank); month.transactions = [...old, ...transactions]; month.cards[bank] = { statementAmount, status: statementAmount == null ? 'pending' : parsedImport?.error || transactions.length === 0 ? 'pending' : 'confirmed', detailTotal: detailTotal(month, bank), sourceNote: parsedImport?.error || (transactions.length ? (parsedImport?.sourceType === 'image' ? '本機截圖 OCR' : '本機 PDF 解析') : '手動輸入') }; saveState(); $('#import-dialog').close(); render(); showToast(`${BANK_NAMES[bank]}已匯入本機資料`); parsedImport = null; $('#statement-file').value = ''; $('#import-statement-amount').value = ''; }

function loadSample() {
  const sampleMonth = '2026-09'; state.months[sampleMonth] = { month: sampleMonth, salary: 42000, sideIncome: 6500, rent: 15000, cards: { yuanta: { statementAmount: 10489, status: 'pending', detailTotal: 0, sourceNote: '依可見項目試算，尚待本期應繳總額確認' }, fubon: { statementAmount: 4211, status: 'confirmed', detailTotal: 4211, sourceNote: '虛構測試資料' } }, transactions: [{ id: uid(), month: sampleMonth, date: '2026-09-02', bank: 'fubon', merchant: '分期測試商店 A', amount: 2098, category: '分期', status: 'active' }, { id: uid(), month: sampleMonth, date: '2026-09-02', bank: 'fubon', merchant: '分期測試商店 A', amount: 2098, category: '分期', status: 'active' }, { id: uid(), month: sampleMonth, date: '2026-09-03', bank: 'fubon', merchant: '分期利息', amount: 70, category: '分期', status: 'active' }, { id: uid(), month: sampleMonth, date: '2026-09-03', bank: 'fubon', merchant: '分期利息', amount: 70, category: '分期', status: 'active' }, { id: uid(), month: sampleMonth, date: '2026-09-06', bank: 'fubon', merchant: '回饋折抵', amount: -125, category: '回饋金', status: 'active' }, { id: uid(), month: sampleMonth, date: '2026-09-10', bank: 'yuanta', merchant: '虛構餐廳', amount: 980, category: '餐費', status: 'active' }, { id: uid(), month: sampleMonth, date: '2026-09-12', bank: 'yuanta', merchant: '綠界測試交易', amount: 560, category: '待確認', status: 'active' }], notes: '虛構測試資料：富邦對帳 4,211 元；元大 10,489 元仍待摘要確認。', updatedAt: new Date().toISOString() }; state.activeMonth = sampleMonth; saveState(); render(); showToast('已載入 2026 年 9 月虛構測試資料'); }

function exportData() { const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = `每月結餘小幫手備份-${new Date().toISOString().slice(0, 10)}.json`; anchor.click(); URL.revokeObjectURL(url); showToast('本機備份已下載'); }
async function importBackup(file) { try { const imported = JSON.parse(await file.text()); if (!imported.months) throw new Error('缺少月份資料'); state = { settings: { rentDefault: DEFAULT_RENT, ...imported.settings }, activeMonth: imported.activeMonth || initialMonth, months: imported.months }; saveState(); render(); showToast('備份已匯入本機'); } catch (error) { showToast(`備份匯入失敗：${error.message}`); } }

document.addEventListener('DOMContentLoaded', () => {
  $('#active-month').addEventListener('change', (event) => { state.activeMonth = event.target.value; currentMonth(); saveState(); render(); });
  $('#new-month').addEventListener('click', () => { const month = prompt('請輸入月份（格式：YYYY-MM）', initialMonth); if (!month || !/^\d{4}-\d{2}$/.test(month)) return; state.activeMonth = month; currentMonth(); saveState(); render(); showToast(`${monthLabel(month)}已建立`); });
  document.querySelectorAll('.nav-item').forEach((button) => button.addEventListener('click', () => { document.querySelectorAll('.nav-item').forEach((item) => item.classList.remove('active')); document.querySelectorAll('.view').forEach((view) => view.classList.remove('active-view')); button.classList.add('active'); $(`#${button.dataset.view}-view`).classList.add('active-view'); }));
  ['#salary', '#side-income', '#rent', '#month-notes'].forEach((selector) => $(selector).addEventListener('input', markChanged));
  $('#save-month').addEventListener('click', updateMonthFromForm); $('#load-sample').addEventListener('click', loadSample); $('#export-data').addEventListener('click', exportData); $('#backup-import').addEventListener('change', (event) => importBackup(event.target.files[0]));
  $('#open-import').addEventListener('click', () => { $('#import-bank').value = 'yuanta'; $('#import-dialog').showModal(); }); $('#capture-screenshot').addEventListener('click', captureScreenshot); $('#statement-file').addEventListener('change', (event) => previewImport(event.target.files[0])); $('#import-bank').addEventListener('change', () => { if ($('#statement-file').files[0]) previewImport($('#statement-file').files[0]); }); $('#confirm-import').addEventListener('click', (event) => { event.preventDefault(); confirmImport(); });
  $('#add-transaction').addEventListener('click', () => openTransactionDialog()); $('#save-transaction').addEventListener('click', (event) => { event.preventDefault(); saveTransactionFromDialog(); }); $('#jump-transactions').addEventListener('click', () => $('#transactions-section').scrollIntoView({ behavior: 'smooth' }));
  $('#transactions-body').addEventListener('change', (event) => { if (event.target.dataset.action !== 'category') return; const item = currentMonth().transactions.find((transaction) => transaction.id === event.target.dataset.id); if (item) { item.category = event.target.value; item.userEdited = true; saveState(); render(); showToast('分類已更新'); } });
  $('#transactions-body').addEventListener('click', (event) => { const action = event.target.dataset.action; const item = currentMonth().transactions.find((transaction) => transaction.id === event.target.dataset.id); if (!item) return; if (action === 'edit') openTransactionDialog(item); if (action === 'delete' && confirm('確定要刪除這筆交易嗎？')) { const month = currentMonth(); month.transactions = month.transactions.filter((transaction) => transaction.id !== item.id); saveState(); render(); showToast('交易已刪除'); } });
  render();
});

// 讓 PDF.js 以瀏覽器模組載入後掛到全域，離線時仍可使用手動匯入與虛構測試資料。
import('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.min.mjs').then((pdfjs) => { window.pdfjsLib = pdfjs; pdfjs.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.worker.min.mjs'; }).catch(() => { window.pdfjsLib = null; });
