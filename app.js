/* ═══════════════════════════════════════════════════════════
   SUMMIT — app.js  (Firebase Edition)
   Pure Vanilla JS + Firebase v9 Modular SDK
═══════════════════════════════════════════════════════════ */

'use strict';

import { FIREBASE_CONFIG } from './firebase-config.js';

// Firebase SDK imports (modular — no npm needed, via CDN)
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
   (cache local pentru UI instant)
══════════════════════════════════════════ */

let currentUser   = null;
let expeditions   = [];          // cache local
let unsubListeners = [];         // Firestore real-time listeners

/* ══════════════════════════════════════════
   3. FIRESTORE PATH HELPERS
══════════════════════════════════════════ */

const userDoc      = ()       => doc(db, 'users', currentUser.uid);
const expCol       = ()       => collection(db, 'users', currentUser.uid, 'expeditions');
const expDoc       = (eId)    => doc(db, 'users', currentUser.uid, 'expeditions', eId);
const memberCol    = (eId)    => collection(db, 'users', currentUser.uid, 'expeditions', eId, 'members');
const memberDoc    = (eId,mId)=> doc(db, 'users', currentUser.uid, 'expeditions', eId, 'members', mId);
const sharedEqCol  = (eId)    => collection(db, 'users', currentUser.uid, 'expeditions', eId, 'sharedEquipment');
const sharedEqDoc  = (eId,iId)=> doc(db, 'users', currentUser.uid, 'expeditions', eId, 'sharedEquipment', iId);
const equipCol     = (eId,mId)=> collection(db, 'users', currentUser.uid, 'expeditions', eId, 'members', mId, 'equipment');
const equipDoc     = (eId,mId,iId)=> doc(db, 'users', currentUser.uid, 'expeditions', eId, 'members', mId, 'equipment', iId);
const expenseCol   = (eId)    => collection(db, 'users', currentUser.uid, 'expeditions', eId, 'expenses');
const expenseDoc   = (eId,xId)=> doc(db, 'users', currentUser.uid, 'expeditions', eId, 'expenses', xId);

/* ══════════════════════════════════════════
   4. SYNC STATUS UI
══════════════════════════════════════════ */

function setSyncing() {
  $('#syncDot').className = 'sync-dot syncing';
  $('#syncLabel').textContent = 'Syncing…';
}

function setSynced() {
  $('#syncDot').className = 'sync-dot';
  $('#syncLabel').textContent = 'Synced';
}

function setSyncError() {
  $('#syncDot').className = 'sync-dot error';
  $('#syncLabel').textContent = 'Offline';
}

/* ══════════════════════════════════════════
   5. DATA LOADING — REAL-TIME LISTENERS
══════════════════════════════════════════ */

/**
 * Starts a real-time listener on the expeditions collection.
 * Each expedition document change triggers a full re-render.
 * Sub-collections (members, expenses, etc.) are loaded on demand.
 */
async function startRealtimeSync() {
  // Clear old listeners
  unsubListeners.forEach(u => u());
  unsubListeners = [];

  showLoading(true);

  const q = query(expCol(), orderBy('createdAt', 'desc'));

  const unsub = onSnapshot(q,
    async (snapshot) => {
      setSynced();

      // Build expeditions array with sub-collections
      const newExps = [];
      for (const docSnap of snapshot.docs) {
        const exp = { id: docSnap.id, ...docSnap.data() };
        // Load sub-collections
        exp.members         = await loadSubCollection(memberCol(exp.id), async (m) => {
          m.equipment = await loadSubCollection(equipCol(exp.id, m.id));
          return m;
        });
        exp.sharedEquipment = await loadSubCollection(sharedEqCol(exp.id));
        exp.expenses        = await loadSubCollection(expenseCol(exp.id));
        newExps.push(exp);
      }

      expeditions = newExps;
      showLoading(false);

      // Re-render current page
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
    const snap = await getDocs(colRef);
    const items = [];
    for (const d of snap.docs) {
      let item = { id: d.id, ...d.data() };
      if (transformer) item = await transformer(item);
      items.push(item);
    }
    return items;
  } catch (e) {
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
      budget: data.budget ? parseFloat(data.budget) : null,
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
      budget: data.budget ? parseFloat(data.budget) : null,
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
    // Delete all sub-collections first (Firestore doesn't cascade)
    const exp = getLocalExpedition(expId);
    if (exp) {
      const batch = writeBatch(db);

      // Members + their equipment
      for (const m of exp.members) {
        for (const item of m.equipment) {
          batch.delete(equipDoc(expId, m.id, item.id));
        }
        batch.delete(memberDoc(expId, m.id));
      }
      // Shared equipment
      for (const item of exp.sharedEquipment) {
        batch.delete(sharedEqDoc(expId, item.id));
      }
      // Expenses
      for (const ex of exp.expenses) {
        batch.delete(expenseDoc(expId, ex.id));
      }
      // Main doc
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
    const exp = getLocalExpedition(expId);
    const member = exp?.members.find(m => m.id === memberId);
    const batch = writeBatch(db);

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
      weight: data.weight ? parseFloat(data.weight) : null,
      packed: data.packed || false,
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
      weight: data.weight ? parseFloat(data.weight) : null,
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
      amount: parseFloat(data.amount),
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
      amount: parseFloat(data.amount),
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

function $(sel, ctx = document) { return ctx.querySelector(sel); }
function $$(sel, ctx = document) { return [...ctx.querySelectorAll(sel)]; }

function el(tag, attrs = {}, ...children) {
  const elem = document.createElement(tag);
  Object.entries(attrs).forEach(([k, v]) => {
    if (k === 'class') elem.className = v;
    else if (k === 'html') elem.innerHTML = v;
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
  toast.className = `toast show ${type}`;
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => { toast.className = 'toast'; }, duration);
}

function openModal(id)  { const o = $(`#${id}`); if (o) o.classList.add('open'); }
function closeModal(id) { const o = $(`#${id}`); if (o) o.classList.remove('open'); }

function confirmAction(message, onConfirm) {
  $('#confirmMessage').textContent = message;
  openModal('confirmModal');
  const btn = $('#confirmDeleteBtn');
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
    style: 'currency', currency: 'USD', minimumFractionDigits: 2
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
   12. AUTH
══════════════════════════════════════════ */

function showAuthScreen() {
  $('#authScreen').style.display  = 'flex';
  $('#appWrapper').style.display  = 'none';
}

function showAppScreen(user) {
  $('#authScreen').style.display = 'none';
  $('#appWrapper').style.display = 'flex';

  // Update sidebar user info
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
    'auth/user-not-found':       'No account found with this email.',
    'auth/wrong-password':       'Incorrect password.',
    'auth/email-already-in-use': 'This email is already registered.',
    'auth/weak-password':        'Password must be at least 6 characters.',
    'auth/invalid-email':        'Please enter a valid email address.',
    'auth/too-many-requests':    'Too many attempts. Please try again later.',
    'auth/network-request-failed': 'Network error. Check your connection.',
  };
  return map[code] || 'An error occurred. Please try again.';
}

async function handleLogin(e) {
  e.preventDefault();
  const email    = $('#loginEmail').value.trim();
  const password = $('#loginPassword').value;
  if (!email || !password) { showAuthError('Please fill in all fields.'); return; }

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

  if (!name || !email || !password) { showAuthError('Please fill in all fields.'); return; }
  if (password !== confirm) { showAuthError('Passwords do not match.'); return; }
  if (password.length < 6)  { showAuthError('Password must be at least 6 characters.'); return; }

  const btn = $('#registerBtn');
  setButtonLoading(btn, true);

  try {
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    await updateProfile(cred.user, { displayName: name });
    // Create user profile doc in Firestore
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
  if (!email) { showAuthError('Enter your email address first.'); return; }
  try {
    await sendPasswordResetEmail(auth, email);
    showAuthError(''); // clear error
    showToast('Password reset email sent!', 'success');
  } catch (err) {
    showAuthError(mapFirebaseError(err.code));
  }
}

async function handleSignOut() {
  // Stop listeners before signing out
  unsubListeners.forEach(u => u());
  unsubListeners = [];
  expeditions = [];
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

function openSidebar()  { $('#sidebar').classList.add('open'); $('#sidebarOverlay').classList.add('open'); }
function closeSidebar() { $('#sidebar').classList.remove('open'); $('#sidebarOverlay').classList.remove('open'); }

/* ══════════════════════════════════════════
   14. EXPEDITIONS PAGE
══════════════════════════════════════════ */

function renderExpeditions() {
  const search      = $('#searchInput').value.toLowerCase();
  const statusFilter = $('#filterStatus').value;
  const diffFilter   = $('#filterDifficulty').value;

  let exps = loadExpeditions().filter(e => {
    const matchSearch = !search ||
      e.name.toLowerCase().includes(search) ||
      (e.location || '').toLowerCase().includes(search) ||
      (e.description || '').toLowerCase().includes(search);
    const matchStatus = !statusFilter || e.status === statusFilter;
    const matchDiff   = !diffFilter   || e.difficulty === diffFilter;
    return matchSearch && matchStatus && matchDiff;
  });

  const grid  = $('#expeditionsGrid');
  const empty = $('#expeditionsEmpty');

  if (exps.length === 0) {
    grid.innerHTML = '';
    empty.style.display = 'block';
    return;
  }

  empty.style.display = 'none';
  grid.innerHTML = '';
  exps.forEach(exp => grid.appendChild(buildExpeditionCard(exp)));
}

function buildExpeditionCard(exp) {
  const costs = calcExpeditionCosts(exp);

  return el('div', { class: `exp-card${exp.status}`, onclick: () => openDetailModal