/* ═══════════════════════════════════════════════════════════
   SUMMIT — app.js  (Firebase Edition)
   Pure Vanilla JS + Firebase v9 Modular SDK
═══════════════════════════════════════════════════════════ */

'use strict';

// ✅ Pune config-ul direct:
const FIREBASE_CONFIG = {
  apiKey:            "AIzaSyDFf9sGsd2iCadu2zxxaM3zIzH3t1YOzmo",
  authDomain:        "summit-expedition-manager.firebaseapp.com",
  projectId:         "summit-expedition-manager",
  storageBucket:     "summit-expedition-manager.firebasestorage.app",
  messagingSenderId: "213168288127",
  appId:             "1:213168288127:web:5dc4eaa0aba0db6475aa4a"
};

import { initializeApp }                          from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getAuth, createUserWithEmailAndPassword,
         signInWithEmailAndPassword, signOut,
         onAuthStateChanged, updateProfile,
         sendPasswordResetEmail }                 from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import { getFirestore, collection, doc,
         addDoc, setDoc, getDoc, getDocs,
         updateDoc, deleteDoc, onSnapshot,
         query, orderBy, serverTimestamp,
         writeBatch }                             from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

/* ══════════════════════════════════════════
   1. FIREBASE INIT
══════════════════════════════════════════ */

const firebaseApp = initializeApp(FIREBASE_CONFIG);
const auth        = getAuth(firebaseApp);
const db          = getFirestore(firebaseApp);

/* ══════════════════════════════════════════
   2. IN-MEMORY STATE
══════════════════════════════════════════ */

let currentUser    = null;
let expeditions    = [];
let unsubListeners = [];

/* ══════════════════════════════════════════
   3. FIRESTORE PATH HELPERS
══════════════════════════════════════════ */

const userDoc     = ()          => doc(db, 'users', currentUser.uid);
const expCol      = ()          => collection(db, 'users', currentUser.uid, 'expeditions');
const expDoc      = (eId)       => doc(db, 'users', currentUser.uid, 'expeditions', eId);
const memberCol   = (eId)       => collection(db, 'users', currentUser.uid, 'expeditions', eId, 'members');
const memberDoc   = (eId, mId)  => doc(db, 'users', currentUser.uid, 'expeditions', eId, 'members', mId);
const sharedEqCol = (eId)       => collection(db, 'users', currentUser.uid, 'expeditions', eId, 'sharedEquipment');
const sharedEqDoc = (eId, iId)  => doc(db, 'users', currentUser.uid, 'expeditions', eId, 'sharedEquipment', iId);
const equipCol    = (eId, mId)  => collection(db, 'users', currentUser.uid, 'expeditions', eId, 'members', mId, 'equipment');
const equipDoc    = (eId, mId, iId) => doc(db, 'users', currentUser.uid, 'expeditions', eId, 'members', mId, 'equipment', iId);
const expenseCol  = (eId)       => collection(db, 'users', currentUser.uid, 'expeditions', eId, 'expenses');
const expenseDoc  = (eId, xId)  => doc(db, 'users', currentUser.uid, 'expeditions', eId, 'expenses', xId);

/* ══════════════════════════════════════════
   4. SYNC STATUS UI
══════════════════════════════════════════ */

function setSyncing() {
  $('#syncDot').className   = 'sync-dot syncing';
  $('#syncLabel').textContent = 'Syncing…';
}

function setSynced() {
  $('#syncDot').className   = 'sync-dot';
  $('#syncLabel').textContent = 'Synced';
}

function setSyncError() {
  $('#syncDot').className   = 'sync-dot error';
  $('#syncLabel').textContent = 'Offline';
}

/* ══════════════════════════════════════════
   5. REAL-TIME LISTENER
══════════════════════════════════════════ */

async function startRealtimeSync() {
  unsubListeners.forEach(u => u());
  unsubListeners = [];

  showLoading(true);

  const q = query(expCol(), orderBy('createdAt', 'desc'));

  const unsub = onSnapshot(q,
    async (snapshot) => {
      setSynced();

      const newExps = [];
      for (const docSnap of snapshot.docs) {
        const exp = { id: docSnap.id, ...docSnap.data() };
        exp.members = await loadSubCollection(memberCol(exp.id), async (m) => {
          m.equipment = await loadSubCollection(equipCol(exp.id, m.id));
          return m;
        });
        exp.sharedEquipment = await loadSubCollection(sharedEqCol(exp.id));
        exp.expenses        = await loadSubCollection(expenseCol(exp.id));
        newExps.push(exp);
      }

      expeditions = newExps;
      showLoading(false);
      renderCurrentPage();
      updateExpeditionSelects();
    },
    (error) => {
      console.error('Firestore listener error:', error);
      setSyncError();
      showLoading(false);
      showToast('Connection error — working offline.', 'error');
    }
  );

  unsubListeners.push(unsub);
}

async function loadSubCollection(colRef, transformer = null) {
  try {
    const snap  = await getDocs(colRef);
    const items = [];
    for (const d of snap.docs) {
      let item = { id: d.id, ...d.data() };
      if (transformer) item = await transformer(item);
      items.push(item);
    }
    return items;
  } catch {
    return [];
  }
}

/* ══════════════════════════════════════════
   6. EXPEDITION CRUD
══════════════════════════════════════════ */

async function addExpedition(data) {
  setSyncing();
  try {
    const docRef = await addDoc(expCol(), {
      ...data,
      budget:    data.budget ? parseFloat(data.budget) : null,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    setSynced();
    return docRef.id;
  } catch (e) {
    setSyncError();
    throw e;
  }
}

async function updateExpedition(expId, data) {
  setSyncing();
  try {
    await updateDoc(expDoc(expId), {
      ...data,
      budget:    data.budget ? parseFloat(data.budget) : null,
      updatedAt: serverTimestamp(),
    });
    setSynced();
  } catch (e) {
    setSyncError();
    throw e;
  }
}

async function deleteExpedition(expId) {
  setSyncing();
  try {
    const exp   = getLocalExpedition(expId);
    const batch = writeBatch(db);

    if (exp) {
      for (const m of exp.members) {
        for (const item of m.equipment) {
          batch.delete(equipDoc(expId, m.id, item.id));
        }
        batch.delete(memberDoc(expId, m.id));
      }
      for (const item of exp.sharedEquipment) {
        batch.delete(sharedEqDoc(expId, item.id));
      }
      for (const ex of exp.expenses) {
        batch.delete(expenseDoc(expId, ex.id));
      }
      batch.delete(expDoc(expId));
      await batch.commit();
    } else {
      await deleteDoc(expDoc(expId));
    }
    setSynced();
  } catch (e) {
    setSyncError();
    throw e;
  }
}

function getLocalExpedition(id) {
  return expeditions.find(e => e.id === id) || null;
}

function loadExpeditions() {
  return expeditions;
}

/* ══════════════════════════════════════════
   7. MEMBER CRUD
══════════════════════════════════════════ */

async function addMember(expId, data) {
  setSyncing();
  try {
    const docRef = await addDoc(memberCol(expId), {
      ...data,
      createdAt: serverTimestamp(),
    });
    setSynced();
    return docRef.id;
  } catch (e) {
    setSyncError();
    throw e;
  }
}

async function updateMember(expId, memberId, data) {
  setSyncing();
  try {
    await updateDoc(memberDoc(expId, memberId), {
      ...data,
      updatedAt: serverTimestamp(),
    });
    setSynced();
  } catch (e) {
    setSyncError();
    throw e;
  }
}

async function deleteMember(expId, memberId) {
  setSyncing();
  try {
    const exp    = getLocalExpedition(expId);
    const member = exp?.members.find(m => m.id === memberId);
    const batch  = writeBatch(db);

    if (member) {
      for (const item of member.equipment) {
        batch.delete(equipDoc(expId, memberId, item.id));
      }
    }
    batch.delete(memberDoc(expId, memberId));
    await batch.commit();
    setSynced();
  } catch (e) {
    setSyncError();
    throw e;
  }
}

/* ══════════════════════════════════════════
   8. EQUIPMENT CRUD
══════════════════════════════════════════ */

async function addEquipment(expId, memberId, data) {
  setSyncing();
  try {
    const colRef = memberId === 'shared'
      ? sharedEqCol(expId)
      : equipCol(expId, memberId);
    const docRef = await addDoc(colRef, {
      ...data,
      weight:    data.weight ? parseFloat(data.weight) : null,
      packed:    data.packed || false,
      createdAt: serverTimestamp(),
    });
    setSynced();
    return docRef.id;
  } catch (e) {
    setSyncError();
    throw e;
  }
}

async function updateEquipment(expId, memberId, itemId, data) {
  setSyncing();
  try {
    const dRef = memberId === 'shared'
      ? sharedEqDoc(expId, itemId)
      : equipDoc(expId, memberId, itemId);
    await updateDoc(dRef, {
      ...data,
      weight:    data.weight ? parseFloat(data.weight) : null,
      updatedAt: serverTimestamp(),
    });
    setSynced();
  } catch (e) {
    setSyncError();
    throw e;
  }
}

async function deleteEquipment(expId, memberId, itemId) {
  setSyncing();
  try {
    const dRef = memberId === 'shared'
      ? sharedEqDoc(expId, itemId)
      : equipDoc(expId, memberId, itemId);
    await deleteDoc(dRef);
    setSynced();
  } catch (e) {
    setSyncError();
    throw e;
  }
}

async function toggleEquipmentPacked(expId, memberId, itemId, currentValue) {
  setSyncing();
  try {
    const dRef = memberId === 'shared'
      ? sharedEqDoc(expId, itemId)
      : equipDoc(expId, memberId, itemId);
    await updateDoc(dRef, { packed: !currentValue });
    setSynced();
  } catch (e) {
    setSyncError();
  }
}

/* ══════════════════════════════════════════
   9. EXPENSE CRUD
══════════════════════════════════════════ */

async function addExpense(expId, data) {
  setSyncing();
  try {
    const docRef = await addDoc(expenseCol(expId), {
      ...data,
      amount:    parseFloat(data.amount),
      createdAt: serverTimestamp(),
    });
    setSynced();
    return docRef.id;
  } catch (e) {
    setSyncError();
    throw e;
  }
}

async function updateExpense(expId, expenseId, data) {
  setSyncing();
  try {
    await updateDoc(expenseDoc(expId, expenseId), {
      ...data,
      amount:    parseFloat(data.amount),
      updatedAt: serverTimestamp(),
    });
    setSynced();
  } catch (e) {
    setSyncError();
    throw e;
  }
}

async function deleteExpense(expId, expenseId) {
  setSyncing();
  try {
    await deleteDoc(expenseDoc(expId, expenseId));
    setSynced();
  } catch (e) {
    setSyncError();
    throw e;
  }
}

/* ══════════════════════════════════════════
   10. COST CALCULATIONS
══════════════════════════════════════════ */

function calcExpeditionCosts(exp) {
  const total     = exp.expenses.reduce((s, e) => s + (e.amount || 0), 0);
  const budget    = exp.budget || null;
  const remaining = budget !== null ? budget - total : null;

  const balances = {};
  exp.members.forEach(m => { balances[m.id] = { name: m.name, paid: 0, owes: 0 }; });

  exp.expenses.forEach(expense => {
    const { amount, paidBy, splitType, customSplit } = expense;
    const memberCount = exp.members.length;

    if (paidBy !== 'group' && balances[paidBy]) {
      balances[paidBy].paid += amount;
    }

    if (memberCount > 0) {
      if (splitType === 'equal') {
        const share = amount / memberCount;
        exp.members.forEach(m => { balances[m.id].owes += share; });
      } else if (splitType === 'custom' && customSplit) {
        Object.entries(customSplit).forEach(([mId, share]) => {
          if (balances[mId]) balances[mId].owes += parseFloat(share) || 0;
        });
      }
    }
  });

  const memberBalances = Object.entries(balances).map(([id, b]) => ({
    id, name: b.name, net: b.paid - b.owes,
  }));

  return { total, budget, remaining, memberBalances };
}

/* ══════════════════════════════════════════
   11. UI UTILITIES
══════════════════════════════════════════ */

function $(sel, ctx = document)  { return ctx.querySelector(sel); }
function $$(sel, ctx = document) { return [...ctx.querySelectorAll(sel)]; }

function el(tag, attrs = {}, ...children) {
  const elem = document.createElement(tag);
  Object.entries(attrs).forEach(([k, v]) => {
    if (k === 'class')       elem.className = v;
    else if (k === 'html')   elem.innerHTML = v;
    else if (k.startsWith('on')) elem.addEventListener(k.slice(2), v);
    else elem.setAttribute(k, v);
  });
  children.forEach(c => {
    if (c == null) return;
    elem.append(typeof c === 'string' ? document.createTextNode(c) : c);
  });
  return elem;
}

function showToast(msg, type = 'info', duration = 3500) {
  const toast = $('#toast');
  toast.textContent = msg;
  toast.className   = `toast show ${type}`;
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => { toast.className = 'toast'; }, duration);
}

function openModal(id)  { const o = $(`#${id}`); if (o) o.classList.add('open'); }
function closeModal(id) { const o = $(`#${id}`); if (o) o.classList.remove('open'); }

function confirmAction(message, onConfirm) {
  $('#confirmMessage').textContent = message;
  openModal('confirmModal');
  const btn    = $('#confirmDeleteBtn');
  const newBtn = btn.cloneNode(true);
  btn.parentNode.replaceChild(newBtn, btn);
  newBtn.addEventListener('click', () => { onConfirm(); closeModal('confirmModal'); });
}

function showLoading(show) {
  $('#loadingOverlay').classList.toggle('show', show);
}

function formatDate(dateStr) {
  if (!dateStr) return '—';
  const [y, m, d] = dateStr.split('-');
  return `${d}/${m}/${y}`;
}

function formatCurrency(amount) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD', minimumFractionDigits: 2,
  }).format(amount || 0);
}

function capitalize(str) {
  return str ? str.charAt(0).toUpperCase() + str.slice(1) : '';
}

function getInitials(name) {
  return (name || '?').split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
}

function validateForm(fields) {
  let valid = true;
  fields.forEach(({ el: input, test }) => {
    const ok = test(input.value.trim());
    input.classList.toggle('invalid', !ok);
    if (!ok) valid = false;
  });
  return valid;
}

function setButtonLoading(btn, loading) {
  btn.disabled = loading;
  btn.dataset.originalText = btn.dataset.originalText || btn.textContent;
  btn.textContent = loading ? 'Please wait…' : btn.dataset.originalText;
}

/* ══════════════════════════════════════════
   12. AUTH FUNCTIONS
══════════════════════════════════════════ */

function showAuthScreen() {
  $('#authScreen').style.display = 'flex';
  $('#appWrapper').style.display = 'none';
}

function showAppScreen(user) {
  $('#authScreen').style.display = 'none';
  $('#appWrapper').style.display = 'flex';

  const name = user.displayName || user.email.split('@')[0];
  $('#userName').textContent  = name;
  $('#userEmail').textContent = user.email;
  $('#userAvatar').textContent = getInitials(name);
}

function showAuthError(msg) {
  const errEl = $('#authError');
  errEl.textContent = msg;
  errEl.classList.add('show');
  setTimeout(() => errEl.classList.remove('show'), 5000);
}

function mapFirebaseError(code) {
  const map = {
    'auth/user-not-found':         'No account found with this email.',
    'auth/wrong-password':         'Incorrect password.',
    'auth/invalid-credential':     'Invalid email or password.',
    'auth/email-already-in-use':   'This email is already registered.',
    'auth/weak-password':          'Password must be at least 6 characters.',
    'auth/invalid-email':          'Please enter a valid email address.',
    'auth/too-many-requests':      'Too many attempts. Please try again later.',
    'auth/network-request-failed': 'Network error. Check your connection.',
  };
  return map[code] || `An error occurred (${code}). Please try again.`;
}

async function handleLogin(e) {
  e.preventDefault();
  const email    = $('#loginEmail').value.trim();
  const password = $('#loginPassword').value;

  if (!email || !password) {
    showAuthError('Please fill in all fields.');
    return;
  }

  const btn = $('#loginBtn');
  setButtonLoading(btn, true);

  try {
    await signInWithEmailAndPassword(auth, email, password);
    // onAuthStateChanged handles the rest
  } catch (err) {
    showAuthError(mapFirebaseError(err.code));
    setButtonLoading(btn, false);
  }
}

async function handleRegister(e) {
  e.preventDefault();
  const name     = $('#registerName').value.trim();
  const email    = $('#registerEmail').value.trim();
  const password = $('#registerPassword').value;
  const confirm  = $('#registerPasswordConfirm').value;

  if (!name || !email || !password || !confirm) {
    showAuthError('Please fill in all fields.');
    return;
  }
  if (password !== confirm) {
    showAuthError('Passwords do not match.');
    return;
  }
  if (password.length < 6) {
    showAuthError('Password must be at least 6 characters.');
    return;
  }

  const btn = $('#registerBtn');
  setButtonLoading(btn, true);

  try {
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    await updateProfile(cred.user, { displayName: name });
    await setDoc(userDoc(), {
      displayName: name,
      email,
      createdAt: serverTimestamp(),
    });
    // onAuthStateChanged handles the rest
  } catch (err) {
    showAuthError(mapFirebaseError(err.code));
    setButtonLoading(btn, false);
  }
}

async function handleForgotPassword() {
  const email = $('#loginEmail').value.trim();
  if (!email) {
    showAuthError('Enter your email address first.');
    return;
  }
  try {
    await sendPasswordResetEmail(auth, email);
    showToast('Password reset email sent! Check your inbox.', 'success');
  } catch (err) {
    showAuthError(mapFirebaseError(err.code));
  }
}

async function handleSignOut() {
  unsubListeners.forEach(u => u());
  unsubListeners = [];
  expeditions    = [];
  await signOut(auth);
}

/* ══════════════════════════════════════════
   13. NAVIGATION
══════════════════════════════════════════ */

const PAGE_TITLES = {
  expeditions: 'Expeditions',
  calendar:    'Calendar',
  members:     'Members',
  costs:       'Costs',
};

let currentPage = 'expeditions';

function navigateTo(page) {
  currentPage = page;
  $$('.nav-item').forEach(item => item.classList.toggle('active', item.dataset.page === page));
  $$('.page').forEach(p => p.classList.toggle('active', p.id === `page-${page}`));
  $('#topbarTitle').textContent = PAGE_TITLES[page] || page;
  renderCurrentPage();
  if (window.innerWidth <= 768) closeSidebar();
}

function renderCurrentPage() {
  switch (currentPage) {
    case 'expeditions': renderExpeditions(); break;
    case 'calendar':    renderCalendar();    break;
    case 'members':     renderMembersPage(); break;
    case 'costs':       renderCostsPage();   break;
  }
}

function openSidebar()  {
  $('#sidebar').classList.add('open');
  $('#sidebarOverlay').classList.add('open');
}

function closeSidebar() {
  $('#sidebar').classList.remove('open');
  $('#sidebarOverlay').classList.remove('open');
}

/* ══════════════════════════════════════════
   14. EXPEDITIONS PAGE
══════════════════════════════════════════ */

function renderExpeditions() {
  const search       = $('#searchInput').value.toLowerCase();
  const statusFilter = $('#filterStatus').value;
  const diffFilter   = $('#filterDifficulty').value;

  const exps = loadExpeditions().filter(e => {
    const matchSearch = !search ||
      e.name.toLowerCase().includes(search) ||
      (e.location    || '').toLowerCase().includes(search) ||
      (e.description || '').toLowerCase().includes(search);
    const matchStatus = !statusFilter || e.status     === statusFilter;
    const matchDiff   = !diffFilter   || e.difficulty === diffFilter;
    return matchSearch && matchStatus && matchDiff;
  });

  const grid  = $('#expeditionsGrid');
  const empty = $('#expeditionsEmpty');

  if (exps.length === 0) {
    grid.innerHTML  = '';
    empty.style.display = 'block';
    return;
  }

  empty.style.display = 'none';
  grid.innerHTML      = '';
  exps.forEach(exp => grid.appendChild(buildExpeditionCard(exp)));
}

function buildExpeditionCard(exp) {
  const costs = calcExpeditionCosts(exp);

  return el('div', { class: `exp-card ${exp.status}`, onclick: () => openDetailModal(exp.id) },
    el('div', { class: 'card-header' },
      el('div', { class: 'card-title' }, exp.name),
      el('div', { class: 'card-actions' },
        el('button', { class: 'btn-icon', title: 'Edit',
          onclick: (e) => { e.stopPropagation(); openExpeditionModal(exp.id); }
        }, '✏️'),
        el('button', { class: 'btn-icon', title: 'Delete',
          onclick: (e) => {
            e.stopPropagation();
            confirmAction(`Delete "${exp.name}"? This cannot be undone.`, async () => {
              try {
                await deleteExpedition(exp.id);
                showToast('Expedition deleted.', 'info');
              } catch { showToast('Delete failed.', 'error'); }
            });
          }
        }, '🗑️'),
      )
    ),
    el('div', { class: 'card-location' }, '📍 ', exp.location || '—'),
    el('div', { class: 'card-dates'    }, '📆 ', formatDate(exp.startDate), ' → ', formatDate(exp.endDate)),
    el('div', { class: 'card-footer'   },
      el('span', { class: `badge badge-status ${exp.status}`         }, capitalize(exp.status)),
      el('span', { class: `badge badge-difficulty ${exp.difficulty}` }, capitalize(exp.difficulty)),
      el('span', { class: 'card-members' }, `👤 ${exp.members.length}`),
      costs.total > 0
        ? el('span', { class: 'card-members' }, `💵 ${formatCurrency(costs.total)}`)
        : null
    )
  );
}

/* ── Expedition Modal ── */

function openExpeditionModal(expId = null) {
  $('#expeditionForm').reset();
  $$('#expeditionForm input, #expeditionForm select').forEach(i => i.classList.remove('invalid'));

  if (expId) {
    const exp = getLocalExpedition(expId);
    if (!exp) return;
    $('#expeditionModalTitle').textContent = 'Edit Expedition';
    $('#expId').value          = exp.id;
    $('#expName').value        = exp.name;
    $('#expDescription').value = exp.description || '';
    $('#expLocation').value    = exp.location    || '';
    $('#expCoords').value      = exp.coords      || '';
    $('#expStartDate').value   = exp.startDate   || '';
    $('#expEndDate').value     = exp.endDate     || '';
    $('#expDifficulty').value  = exp.difficulty  || '';
    $('#expStatus').value      = exp.status      || 'planned';
    $('#expBudget').value      = exp.budget      || '';
  } else {
    $('#expeditionModalTitle').textContent = 'New Expedition';
    $('#expId').value     = '';
    $('#expStatus').value = 'planned';
  }

  openModal('expeditionModal');
}

async function saveExpeditionForm() {
  const valid = validateForm([
    { el: $('#expName'),       test: v => v.length > 0 },
    { el: $('#expLocation'),   test: v => v.length > 0 },
    { el: $('#expStartDate'),  test: v => v.length > 0 },
    { el: $('#expEndDate'),    test: v => v.length > 0 },
    { el: $('#expDifficulty'), test: v => v.length > 0 },
    { el: $('#expStatus'),     test: v => v.length > 0 },
  ]);
  if (!valid) { showToast('Please fill in all required fields.', 'error'); return; }

  const startDate = $('#expStartDate').value;
  const endDate   = $('#expEndDate').value;
  if (endDate < startDate) {
    $('#expEndDate').classList.add('invalid');
    showToast('End date must be after start date.', 'error');
    return;
  }

  const data = {
    name:        $('#expName').value.trim(),
    description: $('#expDescription').value.trim(),
    location:    $('#expLocation').value.trim(),
    coords:      $('#expCoords').value.trim(),
    startDate,
    endDate,
    difficulty:  $('#expDifficulty').value,
    status:      $('#expStatus').value,
    budget:      $('#expBudget').value || null,
  };

  const btn = $('#saveExpeditionBtn');
  setButtonLoading(btn, true);

  try {
    const id = $('#expId').value;
    if (id) {
      await updateExpedition(id, data);
      showToast('Expedition updated! ✅', 'success');
    } else {
      await addExpedition(data);
      showToast('Expedition created! 🏔️', 'success');
    }
    closeModal('expeditionModal');
  } catch {
    showToast('Save failed. Check your connection.', 'error');
  } finally {
    setButtonLoading(btn, false);
  }
}

/* ── Detail Modal ── */

function openDetailModal(expId) {
  const exp = getLocalExpedition(expId);
  if (!exp) return;

  $('#detailModalTitle').textContent = exp.name;
  const costs = calcExpeditionCosts(exp);
  const body  = $('#detailModalBody');
  body.innerHTML = '';

  const grid = el('div', { class: 'detail-grid' },
    el('div', { class: 'detail-item' },
      el('span', { class: 'detail-label' }, 'Location'),
      el('span', { class: 'detail-value' }, (exp.location || '—') + (exp.coords ? ` (${exp.coords})` : ''))
    ),
    el('div', { class: 'detail-item' },
      el('span', { class: 'detail-label' }, 'Dates'),
      el('span', { class: 'detail-value' }, `${formatDate(exp.startDate)} → ${formatDate(exp.endDate)}`)
    ),
    el('div', { class: 'detail-item' },
      el('span', { class: 'detail-label' }, 'Status'),
      el('span', { class: `detail-value badge badge-status ${exp.status}` }, capitalize(exp.status))
    ),
    el('div', { class: 'detail-item' },
      el('span', { class: 'detail-label' }, 'Difficulty'),
      el('span', { class: `detail-value badge badge-difficulty ${exp.difficulty}` }, capitalize(exp.difficulty))
    ),
    el('div', { class: 'detail-item' },
      el('span', { class: 'detail-label' }, 'Members'),
      el('span', { class: 'detail-value' }, `${exp.members.length} member(s)`)
    ),
    el('div', { class: 'detail-item' },
      el('span', { class: 'detail-label' }, 'Total Cost'),
      el('span', { class: 'detail-value' }, formatCurrency(costs.total))
    ),
  );

  if (exp.description) {
    grid.appendChild(el('div', { class: 'detail-item full' },
      el('span', { class: 'detail-label' }, 'Description'),
      el('span', { class: 'detail-value' }, exp.description)
    ));
  }

  if (exp.budget) {
    const pct  = Math.min((costs.total / exp.budget) * 100, 100);
    const over = costs.total > exp.budget;
    grid.appendChild(el('div', { class: 'detail-item full' },
      el('span', { class: 'detail-label' },
        `Budget: ${formatCurrency(exp.budget)} | Remaining: ${formatCurrency(costs.remaining)}`
      ),
      el('div', { class: 'progress-bar-wrap' },
        el('div', { class: `progress-bar-fill${over ? ' over' : ''}`, style: `width:${pct}%` })
      )
    ));
  }

  body.appendChild(grid);

  if (exp.members.length > 0) {
    const sec = el('div', { class: 'detail-section' }, el('h3', {}, '👥 Team Members'));
    exp.members.forEach(m => {
      sec.appendChild(el('div', { class: 'balance-row', style: 'margin-bottom:6px;' },
        el('span', { class: 'balance-name' }, m.name),
        el('span', { class: 'cat-badge'    }, capitalize(m.role))
      ));
    });
    body.appendChild(sec);
  }

  if (costs.memberBalances.length > 0) {
    const sec = el('div', { class: 'detail-section' }, el('h3', {}, '💰 Cost Balances'));
    costs.memberBalances.forEach(b => {
      const cls   = b.net > 0.005 ? 'gets' : b.net < -0.005 ? 'owes' : 'even';
      const label = b.net > 0.005
        ? `gets back ${formatCurrency(b.net)}`
        : b.net < -0.005
          ? `owes ${formatCurrency(Math.abs(b.net))}`
          : 'settled ✓';
      sec.appendChild(el('div', { class: 'balance-row', style: 'margin-bottom:6px;' },
        el('span', { class: 'balance-name'       }, b.name),
        el('span', { class: `balance-amount ${cls}` }, label)
      ));
    });
    body.appendChild(sec);
  }

  $('#detailEditBtn').onclick   = () => { closeModal('detailModal'); openExpeditionModal(expId); };
  $('#detailDeleteBtn').onclick = () => {
    closeModal('detailModal');
    confirmAction(`Delete "${exp.name}"? This cannot be undone.`, async () => {
      try {
        await deleteExpedition(expId);
        showToast('Expedition deleted.', 'info');
      } catch { showToast('Delete failed.', 'error'); }
    });
  };

  openModal('detailModal');
}

/* ══════════════════════════════════════════
   15. CALENDAR
══════════════════════════════════════════ */

let calYear  = new Date().getFullYear();
let calMonth = new Date().getMonth();

function renderCalendar() {
  const MONTHS = ['January','February','March','April','May','June',
                  'July','August','September','October','November','December'];

  $('#calMonthLabel').textContent = `${MONTHS[calMonth]} ${calYear}`;

  const grid = $('#calendarGrid');
  grid.innerHTML = '';

  const headerRow = el('div', { class: 'cal-day-headers' });
  ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].forEach(d =>
    headerRow.appendChild(el('div', { class: 'cal-day-header' }, d))
  );
  grid.appendChild(headerRow);

  const daysContainer = el('div', { class: 'cal-days' });
  const firstDay      = new Date(calYear, calMonth, 1).getDay();
  const daysInMonth   = new Date(calYear, calMonth + 1, 0).getDate();
  const daysInPrev    = new Date(calYear, calMonth, 0).getDate();
  const today         = new Date();
  const todayStr      = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
  const totalCells    = Math.ceil((firstDay + daysInMonth) / 7) * 7;

  for (let i = 0; i < totalCells; i++) {
    let dayNum, isCurrentMonth = true;

    if (i < firstDay) {
      dayNum = daysInPrev - firstDay + i + 1;
      isCurrentMonth = false;
    } else if (i >= firstDay + daysInMonth) {
      dayNum = i - firstDay - daysInMonth + 1;
      isCurrentMonth = false;
    } else {
      dayNum = i - firstDay + 1;
    }

    const dateStr = `${calYear}-${String(calMonth+1).padStart(2,'0')}-${String(dayNum).padStart(2,'0')}`;
    const isToday = isCurrentMonth && dateStr === todayStr;

    const dayCell = el('div', {
      class: `cal-day${!isCurrentMonth ? ' other-month' : ''}${isToday ? ' today' : ''}`,
    }, el('div', { class: 'cal-day-num' }, String(dayNum)));

    if (isCurrentMonth) {
      loadExpeditions().forEach(exp => {
        if (dateStr >= exp.startDate && dateStr <= exp.endDate) {
          dayCell.appendChild(el('div', {
            class:   `cal-exp-block ${exp.status}`,
            title:   exp.name,
            onclick: () => openDetailModal(exp.id),
          }, exp.name));
        }
      });
    }

    daysContainer.appendChild(dayCell);
  }

  grid.appendChild(daysContainer);
}

/* ══════════════════════════════════════════
   16. MEMBERS PAGE
══════════════════════════════════════════ */

let currentMemberExpId = '';

function renderMembersPage() {
  const select   = $('#memberExpeditionFilter');
  const savedVal = currentMemberExpId || select.value;

  select.innerHTML = '<option value="">— Select an Expedition —</option>';
  loadExpeditions().forEach(e =>
    select.appendChild(el('option', { value: e.id }, e.name))
  );

  if (savedVal) select.value = savedVal;
  currentMemberExpId = select.value;

  if (currentMemberExpId) {
    $('#addMemberBtn').style.display = 'inline-flex';
    renderMembersContent(currentMemberExpId);
  } else {
    $('#addMemberBtn').style.display = 'none';
    $('#membersContent').innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">👥</div>
        <h3>Select an expedition</h3>
        <p>Choose an expedition above to manage its members.</p>
      </div>`;
  }
}

function renderMembersContent(expId) {
  const exp = getLocalExpedition(expId);
  if (!exp) return;

  const container = $('#membersContent');
  container.innerHTML = '';

  // Shared equipment section
  const sharedSection = el('div', { class: 'shared-equip-section' },
    el('div', { class: 'section-title' },
      el('span', {}, '🎒 Shared Expedition Equipment'),
      el('button', { class: 'btn btn-sm btn-ghost',
        onclick: () => openEquipmentModal(expId, 'shared')
      }, '+ Add Item')
    )
  );

  if (exp.sharedEquipment.length === 0) {
    sharedSection.appendChild(
      el('p', { class: 'text-muted', style: 'font-size:.85rem;' }, 'No shared equipment added yet.')
    );
  } else {
    const list = el('div', { class: 'equip-list' });
    exp.sharedEquipment.forEach(item => list.appendChild(buildEquipItem(expId, 'shared', item)));
    sharedSection.appendChild(list);
  }
  container.appendChild(sharedSection);

  if (exp.members.length === 0) {
    container.appendChild(el('div', { class: 'empty-state' },
      el('div', { class: 'empty-icon' }, '👤'),
      el('h3', {}, 'No members yet'),
      el('p',  {}, 'Add team members to this expedition.')
    ));
    return;
  }

  const grid = el('div', { class: 'members-grid' });
  exp.members.forEach(member => grid.appendChild(buildMemberCard(exp, member)));
  container.appendChild(grid);
}

function buildMemberCard(exp, member) {
  const card = el('div', { class: 'member-card' },
    el('div', { class: 'member-card-header' },
      el('div', { class: 'member-avatar' }, getInitials(member.name)),
      el('div', { class: 'member-info' },
        el('div', { class: 'member-name' }, member.name),
        el('div', { class: 'member-role' }, capitalize(member.role))
      ),
      el('div', { class: 'member-actions' },
        el('button', { class: 'btn-icon', title: 'Edit',
          onclick: () => openMemberModal(exp.id, member.id)
        }, '✏️'),
        el('button', { class: 'btn-icon', title: 'Delete',
          onclick: () => confirmAction(`Remove ${member.name}?`, async () => {
            try {
              await deleteMember(exp.id, member.id);
              showToast('Member removed.', 'info');
            } catch { showToast('Delete failed.', 'error'); }
          })
        }, '🗑️')
      )
    )
  );

  if (member.contact || member.emergency) {
    const contactDiv = el('div', { class: 'member-contact' });
    if (member.contact)   contactDiv.appendChild(el('span', {}, `📞 ${member.contact}`));
    if (member.emergency) contactDiv.appendChild(el('span', {}, `🆘 ${member.emergency}`));
    card.appendChild(contactDiv);
  }

  const equipSec = el('div', { class: 'equip-section' },
    el('div', { class: 'equip-section-title' },
      el('span', {}, `🎒 Equipment (${member.equipment.length})`),
      el('button', { class: 'btn btn-sm btn-ghost',
        onclick: () => openEquipmentModal(exp.id, member.id)
      }, '+ Add')
    )
  );

  if (member.equipment.length > 0) {
    const list = el('div', { class: 'equip-list' });
    member.equipment.forEach(item => list.appendChild(buildEquipItem(exp.id, member.id, item)));
    equipSec.appendChild(list);
  } else {
    equipSec.appendChild(el('p', { class: 'text-muted', style: 'font-size:.78rem;' }, 'No items yet.'));
  }

  card.appendChild(equipSec);
  return card;
}

function buildEquipItem(expId, memberId, item) {
  const row = el('div', { class: `equip-item${item.packed ? ' packed' : ''}` });

  const checkbox = el('input', { type: 'checkbox' });
  checkbox.checked = item.packed;
  checkbox.addEventListener('change', async () => {
    await toggleEquipmentPacked(expId, memberId, item.id, item.packed);
  });

  const nameSpan = el('span', { class: 'equip-item-name' }, item.name);
  const catBadge = el('span', { class: 'equip-item-cat'  }, capitalize(item.category));
  const actions  = el('div',  { class: 'equip-item-actions' },
    el('button', { class: 'btn-icon', title: 'Edit', style: 'font-size:.75rem;',
      onclick: () => openEquipmentModal(expId, memberId, item.id)
    }, '✏️'),
    el('button', { class: 'btn-icon', title: 'Delete', style: 'font-size:.75rem;',
      onclick: () => confirmAction(`Delete "${item.name}"?`, async () => {
        try {
          await deleteEquipment(expId, memberId, item.id);
        } catch { showToast('Delete failed.', 'error'); }
      })
    }, '🗑️')
  );

  if (item.weight) {
    row.appendChild(el('span', { class: 'text-muted', style: 'font-size:.7rem;' }, `${item.weight}kg`));
  }

  row.append(checkbox, nameSpan, catBadge, actions);
  return row;
}

/* ── Member Modal ── */

function openMemberModal(expId, memberId = null) {
  $('#memberForm').reset();
  $('#memberExpId').value = expId;

  if (memberId) {
    const exp    = getLocalExpedition(expId);
    const member = exp?.members.find(m => m.id === memberId);
    if (!member) return;
    $('#memberModalTitle').textContent  = 'Edit Member';
    $('#memberId').value                = member.id;
    $('#memberName').value              = member.name;
    $('#memberRole').value              = member.role;
    $('#memberContact').value           = member.contact   || '';
    $('#memberEmergency').value         = member.emergency || '';
  } else {
    $('#memberModalTitle').textContent = 'Add Member';
    $('#memberId').value               = '';
  }

  openModal('memberModal');
}

async function saveMemberForm() {
  const valid = validateForm([
    { el: $('#memberName'), test: v => v.length > 0 },
  ]);
  if (!valid) { showToast('Member name is required.', 'error'); return; }

  const expId = $('#memberExpId').value;
  const id    = $('#memberId').value;
  const data  = {
    name:      $('#memberName').value.trim(),
    role:      $('#memberRole').value,
    contact:   $('#memberContact').value.trim(),
    emergency: $('#memberEmergency').value.trim(),
  };

  const btn = $('#saveMemberBtn');
  setButtonLoading(btn, true);

  try {
    if (id) {
      await updateMember(expId, id, data);
      showToast('Member updated!', 'success');
    } else {
      await addMember(expId, data);
      showToast('Member added!', 'success');
    }
    closeModal('memberModal');
  } catch { showToast('Save failed.', 'error'); }
  finally  { setButtonLoading(btn, false); }
}

/* ── Equipment Modal ── */

function openEquipmentModal(expId, memberId, itemId = null) {
  $('#equipmentForm').reset();
  $('#equipExpId').value    = expId;
  $('#equipMemberId').value = memberId;

  if (itemId) {
    const exp  = getLocalExpedition(expId);
    const list = memberId === 'shared'
      ? exp.sharedEquipment
      : exp.members.find(m => m.id === memberId)?.equipment;
    const item = list?.find(i => i.id === itemId);
    if (!item) return;
    $('#equipmentModalTitle').textContent = 'Edit Equipment';
    $('#equipId').value       = item.id;
    $('#equipName').value     = item.name;
    $('#equipCategory').value = item.category;
    $('#equipWeight').value   = item.weight || '';
    $('#equipPacked').checked = item.packed;
  } else {
    $('#equipmentModalTitle').textContent = 'Add Equipment';
    $('#equipId').value = '';
  }

  openModal('equipmentModal');
}

async function saveEquipmentForm() {
  const valid = validateForm([
    { el: $('#equipName'), test: v => v.length > 0 },
  ]);
  if (!valid) { showToast('Item name is required.', 'error'); return; }

  const expId    = $('#equipExpId').value;
  const memberId = $('#equipMemberId').value;
  const itemId   = $('#equipId').value;
  const data     = {
    name:     $('#equipName').value.trim(),
    category: $('#equipCategory').value,
    weight:   $('#equipWeight').value,
    packed:   $('#equipPacked').checked,
  };

  const btn = $('#saveEquipmentBtn');
  setButtonLoading(btn, true);

  try {
    if (itemId) {
      await updateEquipment(expId, memberId, itemId, data);
      showToast('Equipment updated!', 'success');
    } else {
      await addEquipment(expId, memberId, data);
      showToast('Equipment added!', 'success');
    }
    closeModal('equipmentModal');
  } catch { showToast('Save failed.', 'error'); }
  finally  { setButtonLoading(btn, false); }
}

/* ══════════════════════════════════════════
   17. COSTS PAGE
══════════════════════════════════════════ */

let currentCostExpId = '';

function renderCostsPage() {
  const select   = $('#costExpeditionFilter');
  const savedVal = currentCostExpId || select.value;

  select.innerHTML = '<option value="">— Select an Expedition —</option>';
  loadExpeditions().forEach(e =>
    select.appendChild(el('option', { value: e.id }, e.name))
  );

  if (savedVal) select.value = savedVal;
  currentCostExpId = select.value;

  if (currentCostExpId) {
    $('#addExpenseBtn').style.display = 'inline-flex';
    renderCostsContent(currentCostExpId);
  } else {
    $('#addExpenseBtn').style.display = 'none';
    $('#costsContent').innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">💰</div>
        <h3>Select an expedition</h3>
        <p>Choose an expedition above to track its costs.</p>
      </div>`;
  }
}

function renderCostsContent(expId) {
  const exp = getLocalExpedition(expId);
  if (!exp) return;

  const costs     = calcExpeditionCosts(exp);
  const container = $('#costsContent');
  container.innerHTML = '';

  // Summary cards
  const summary = el('div', { class: 'costs-summary' });
  [
    { label: 'Total Spent', value: formatCurrency(costs.total), cls: '' },
    { label: 'Budget',      value: costs.budget ? formatCurrency(costs.budget) : '—', cls: '' },
    { label: 'Remaining',   value: costs.remaining !== null ? formatCurrency(costs.remaining) : '—',
      cls: costs.remaining !== null ? (costs.remaining >= 0 ? 'positive' : 'negative') : '' },
    { label: 'Expenses',    value: exp.expenses.length, cls: '' },
  ].forEach(({ label, value, cls }) => {
    summary.appendChild(el('div', { class: 'summary-card' },
      el('div', { class: 'summary-card-label' }, label),
      el('div', { class: `summary-card-value ${cls}` }, String(value))
    ));
  });
  container.appendChild(summary);

  // Budget progress bar
  if (costs.budget && costs.total > 0) {
    const pct = Math.min((costs.total / costs.budget) * 100, 100);
    container.appendChild(el('div', { class: 'progress-bar-wrap', style: 'margin-bottom:24px;' },
      el('div', {
        class: `progress-bar-fill${costs.total > costs.budget ? ' over' : ''}`,
        style: `width:${pct}%`,
      })
    ));
  }

  // Expenses table
  if (exp.expenses.length === 0) {
    container.appendChild(el('div', { class: 'empty-state' },
      el('div', { class: 'empty-icon' }, '🧾'),
      el('h3', {}, 'No expenses yet'),
      el('p',  {}, 'Add the first expense to start tracking costs.')
    ));
  } else {
    const tableWrap = el('div', { class: 'expenses-table-wrap' });
    const table     = el('table', { class: 'expenses-table' });

    table.appendChild(el('thead', {},
      el('tr', {},
        el('th', {}, 'Title'),
        el('th', {}, 'Category'),
        el('th', {}, 'Amount'),
        el('th', {}, 'Paid By'),
        el('th', {}, 'Split'),
        el('th', {}, 'Date'),
        el('th', {}, 'Actions'),
      )
    ));

    const tbody = el('tbody', {});
    exp.expenses.forEach(expense => {
      const paidByName = expense.paidBy === 'group'
        ? 'Group'
        : exp.members.find(m => m.id === expense.paidBy)?.name || 'Unknown';

      tbody.appendChild(el('tr', {},
        el('td', {}, expense.title),
        el('td', {}, el('span', { class: 'cat-badge' }, capitalize(expense.category))),
        el('td', { class: 'amount-cell' }, formatCurrency(expense.amount)),
        el('td', {}, paidByName),
        el('td', {}, capitalize(expense.splitType)),
        el('td', {}, formatDate(expense.date)),
        el('td', {},
          el('button', { class: 'btn-icon', title: 'Edit',
            onclick: () => openExpenseModal(expId, expense.id)
          }, '✏️'),
          el('button', { class: 'btn-icon', title: 'Delete',
            onclick: () => confirmAction(`Delete "${expense.title}"?`, async () => {
              try {
                await deleteExpense(expId, expense.id);
                showToast('Expense deleted.', 'info');
              } catch { showToast('Delete failed.', 'error'); }
            })
          }, '🗑️')
        )
      ));
    });

    table.appendChild(tbody);
    tableWrap.appendChild(table);
    container.appendChild(tableWrap);
  }

  // Member balances
  if (costs.memberBalances.length > 0) {
    const balSec = el('div', { class: 'balance-section' },
      el('div', { class: 'section-title' }, '⚖️ Member Balances')
    );
    const list = el('div', { class: 'balance-list' });
    costs.memberBalances.forEach(b => {
      const cls   = b.net > 0.005 ? 'gets' : b.net < -0.005 ? 'owes' : 'even';
      const label = b.net > 0.005
        ? `gets back ${formatCurrency(b.net)}`
        : b.net < -0.005
          ? `owes ${formatCurrency(Math.abs(b.net))}`
          : 'settled ✓';
      list.appendChild(el('div', { class: 'balance-row' },
        el('span', { class: 'balance-name'          }, b.name),
        el('span', { class: `balance-amount ${cls}` }, label)
      ));
    });
    balSec.appendChild(list);
    container.appendChild(balSec);
  }
}

/* ── Expense Modal ── */

function openExpenseModal(expId, expenseId = null) {
  const exp = getLocalExpedition(expId);
  if (!exp) return;

  $('#expenseForm').reset();
  $('#expenseExpId').value = expId;
  $('#customSplitContainer').style.display = 'none';

  // Populate "Paid By" dropdown
  const paidBySelect = $('#expensePaidBy');
  paidBySelect.innerHTML = '<option value="group">Group / Shared</option>';
  exp.members.forEach(m =>
    paidBySelect.appendChild(el('option', { value: m.id }, m.name))
  );

  $('#expenseDate').value = new Date().toISOString().split('T')[0];

  if (expenseId) {
    const expense = exp.expenses.find(e => e.id === expenseId);
    if (!expense) return;
    $('#expenseModalTitle').textContent = 'Edit Expense';
    $('#expenseId').value        = expense.id;
    $('#expenseTitle').value     = expense.title;
    $('#expenseAmount').value    = expense.amount;
    $('#expenseCategory').value  = expense.category;
    $('#expensePaidBy').value    = expense.paidBy;
    $('#expenseSplitType').value = expense.splitType;
    $('#expenseDate').value      = expense.date;
    if (expense.splitType === 'custom') {
      buildCustomSplitFields(exp, expense.customSplit);
      $('#customSplitContainer').style.display = 'block';
    }
  } else {
    $('#expenseModalTitle').textContent = 'Add Expense';
    $('#expenseId').value = '';
  }

  openModal('expenseModal');
}

function buildCustomSplitFields(exp, existingSplit = {}) {
  const container = $('#customSplitFields');
  container.innerHTML = '';
  exp.members.forEach(m => {
    container.appendChild(el('div', { class: 'custom-split-field' },
      el('label', {}, m.name),
      el('input', {
        type: 'number', min: '0', step: '0.01', placeholder: '0.00',
        'data-member-id': m.id,
        value: existingSplit[m.id] || '',
      })
    ));
  });
}

async function saveExpenseForm() {
  const valid = validateForm([
    { el: $('#expenseTitle'),  test: v => v.length > 0 },
    { el: $('#expenseAmount'), test: v => parseFloat(v) > 0 },
    { el: $('#expenseDate'),   test: v => v.length > 0 },
  ]);
  if (!valid) { showToast('Please fill in all required fields.', 'error'); return; }

  const expId     = $('#expenseExpId').value;
  const expenseId = $('#expenseId').value;
  const splitType = $('#expenseSplitType').value;

  const customSplit = {};
  if (splitType === 'custom') {
    $$('#customSplitFields input').forEach(input => {
      customSplit[input.dataset.memberId] = parseFloat(input.value) || 0;
    });
  }

  const data = {
    title:       $('#expenseTitle').value.trim(),
    amount:      $('#expenseAmount').value,
    category:    $('#expenseCategory').value,
    paidBy:      $('#expensePaidBy').value,
    splitType,
    customSplit,
    date:        $('#expenseDate').value,
  };

  const btn = $('#saveExpenseBtn');
  setButtonLoading(btn, true);

  try {
    if (expenseId) {
      await updateExpense(expId, expenseId, data);
      showToast('Expense updated!', 'success');
    } else {
      await addExpense(expId, data);
      showToast('Expense added!', 'success');
    }
    closeModal('expenseModal');
  } catch { showToast('Save failed.', 'error'); }
  finally  { setButtonLoading(btn, false); }
}

/* ══════════════════════════════════════════
   18. EXPEDITION SELECT SYNC
══════════════════════════════════════════ */

function updateExpeditionSelects() {
  const exps = loadExpeditions();
  ['memberExpeditionFilter', 'costExpeditionFilter'].forEach(selId => {
    const sel = $(`#${selId}`);
    const val = sel.value;
    sel.innerHTML = '<option value="">— Select an Expedition —</option>';
    exps.forEach(e => sel.appendChild(el('option', { value: e.id }, e.name)));
    if (val) sel.value = val;
  });
}

/* ══════════════════════════════════════════
   19. EXPORT / IMPORT
══════════════════════════════════════════ */

function exportData() {
  const exportObj = {
    exportedAt:  new Date().toISOString(),
    expeditions: loadExpeditions(),
  };
  const blob = new Blob([JSON.stringify(exportObj, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = el('a', { href: url, download: `summit-backup-${Date.now()}.json` });
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast('Data exported successfully! 📤', 'success');
}

async function importData(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async (e) => {
    try {
      const imported = JSON.parse(e.target.result);
      const exps = imported.expeditions || (Array.isArray(imported) ? imported : null);
      if (!exps) throw new Error('Invalid format');

      confirmAction(
        `Import ${exps.length} expedition(s)? Existing data will NOT be deleted.`,
        async () => {
          showLoading(true);
          try {
            for (const exp of exps) {
              const { members = [], sharedEquipment = [], expenses = [],
                      id, createdAt, updatedAt, ...expData } = exp;
              const newExpId = await addExpedition(expData);

              for (const m of members) {
                const { equipment = [], id: mId, createdAt: mCa, ...mData } = m;
                const newMId = await addMember(newExpId, mData);
                for (const item of equipment) {
                  const { id: iId, createdAt: iCa, ...iData } = item;
                  await addEquipment(newExpId, newMId, iData);
                }
              }
              for (const item of sharedEquipment) {
                const { id: iId, createdAt: iCa, ...iData } = item;
                await addEquipment(newExpId, 'shared', iData);
              }
              for (const ex of expenses) {
                const { id: xId, createdAt: xCa, ...xData } = ex;
                await addExpense(newExpId, xData);
              }
            }
            showToast(`Imported ${exps.length} expedition(s)! 📥`, 'success');
          } catch {
            showToast('Import failed — check the file format.', 'error');
          } finally {
            showLoading(false);
          }
        }
      );
    } catch {
      showToast('Invalid JSON file.', 'error');
    }
  };
  reader.readAsText(file);
}

/* ══════════════════════════════════════════
   20. AUTH EVENT LISTENERS
   ✅ Se inițializează IMEDIAT la încărcarea paginii
══════════════════════════════════════════ */

function initAuthListeners() {
  // Tab switcher Sign In / Register
  $$('.auth-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      $$('.auth-tab').forEach(t => t.classList.remove('active'));
      $$('.auth-form').forEach(f => f.classList.remove('active'));
      tab.classList.add('active');
      $(`#${tab.dataset.tab}Form`).classList.add('active');
      $('#authError').classList.remove('show');
    });
  });

  // Login
  $('#loginForm').addEventListener('submit', handleLogin);

  // Register ← fix-ul principal
  $('#registerForm').addEventListener('submit', handleRegister);

  // Forgot password
  $('#forgotPasswordBtn').addEventListener('click', handleForgotPassword);
}

/* ══════════════════════════════════════════
   21. APP EVENT LISTENERS
   ✅ Se inițializează doar după login
══════════════════════════════════════════ */

function initAppListeners() {
  // Sign out
  $('#signOutBtn').addEventListener('click', handleSignOut);

  // Sidebar navigation
  $$('.nav-item').forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      navigateTo(item.dataset.page);
    });
  });

  // Mobile sidebar
  $('#hamburger').addEventListener('click', openSidebar);
  $('#sidebarClose').addEventListener('click', closeSidebar);
  $('#sidebarOverlay').addEventListener('click', closeSidebar);

  // Close modals via [data-modal] buttons
  $$('[data-modal]').forEach(btn => {
    btn.addEventListener('click', () => closeModal(btn.dataset.modal));
  });

  // Click outside modal overlay to close
  $$('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeModal(overlay.id);
    });
  });

  // ESC key closes modals
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      $$('.modal-overlay.open').forEach(o => closeModal(o.id));
    }
  });

  // Expeditions page
  $('#newExpeditionBtn').addEventListener('click', () => openExpeditionModal());
  $('#newExpeditionBtnEmpty').addEventListener('click', () => openExpeditionModal());
  $('#saveExpeditionBtn').addEventListener('click', saveExpeditionForm);
  $('#searchInput').addEventListener('input', renderExpeditions);
  $('#filterStatus').addEventListener('change', renderExpeditions);
  $('#filterDifficulty').addEventListener('change', renderExpeditions);

  // Calendar
  $('#calPrev').addEventListener('click', () => {
    calMonth--;
    if (calMonth < 0) { calMonth = 11; calYear--; }
    renderCalendar();
  });
  $('#calNext').addEventListener('click', () => {
    calMonth++;
    if (calMonth > 11) { calMonth = 0; calYear++; }
    renderCalendar();
  });
  $('#calToday').addEventListener('click', () => {
    calYear  = new Date().getFullYear();
    calMonth = new Date().getMonth();
    renderCalendar();
  });

  // Members page
  $('#memberExpeditionFilter').addEventListener('change', (e) => {
    currentMemberExpId = e.target.value;
    renderMembersPage();
  });
  $('#addMemberBtn').addEventListener('click', () => {
    if (currentMemberExpId) openMemberModal(currentMemberExpId);
  });
  $('#saveMemberBtn').addEventListener('click', saveMemberForm);
  $('#saveEquipmentBtn').addEventListener('click', saveEquipmentForm);

  // Costs page
  $('#costExpeditionFilter').addEventListener('change', (e) => {
    currentCostExpId = e.target.value;
    renderCostsPage();
  });
  $('#addExpenseBtn').addEventListener('click', () => {
    if (currentCostExpId) openExpenseModal(currentCostExpId);
  });
  $('#saveExpenseBtn').addEventListener('click', saveExpenseForm);

  // Custom split toggle
  $('#expenseSplitType').addEventListener('change', (e) => {
    const exp = getLocalExpedition($('#expenseExpId').value);
    if (e.target.value === 'custom' && exp) {
      buildCustomSplitFields(exp);
      $('#customSplitContainer').style.display = 'block';
    } else {
      $('#customSplitContainer').style.display = 'none';
    }
  });

  // Export / Import
  $('#exportBtn').addEventListener('click', exportData);
  $('#importFile').addEventListener('change', (e) => {
    importData(e.target.files[0]);
    e.target.value = '';
  });
}

/* ══════════════════════════════════════════
   22. ENTRY POINT
══════════════════════════════════════════ */

// ✅ Auth listeners pornesc IMEDIAT
initAuthListeners();

// ✅ Firebase observă starea autentificării
onAuthStateChanged(auth, async (user) => {
  if (user) {
    currentUser = user;
    showAppScreen(user);
    initAppListeners();
    await startRealtimeSync();
    navigateTo('expeditions');
  } else {
    currentUser = null;
    expeditions = [];
    unsubListeners.forEach(u => u());
    unsubListeners = [];
    showAuthScreen();
  }
});