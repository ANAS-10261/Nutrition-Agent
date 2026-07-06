/**
 * NutriBot — AI Nutrition Agent
 * Main JavaScript  ·  app.js
 */

/* ── State ──────────────────────────────────────────────── */
const state = {
  chatHistory:    [],
  userProfile:    null,
  familyMembers:  [],
  currentTab:     'chat',
  isTyping:       false,
};

/* ── DOM Refs ────────────────────────────────────────────── */
const $ = id => document.getElementById(id);

/* ════════════════════════════════════════════════════════
   INIT
   ════════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  initTabs();
  initChat();
  initBMI();
  initFamilyProfiles();
  initFoodAnalyzer();
  initMealPlanner();
  initDashboard();
  checkAgentStatus();
  initSidebar();
});

/* ── Theme ────────────────────────────────────────────── */
function initTheme() {
  const saved = localStorage.getItem('nutribot-theme') || 'light';
  document.documentElement.setAttribute('data-theme', saved);
  updateThemeIcons(saved);

  const toggleFn = () => {
    const current = document.documentElement.getAttribute('data-theme');
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('nutribot-theme', next);
    updateThemeIcons(next);
  };
  $('themeToggle').addEventListener('click', toggleFn);
  const mob = $('themeToggleMobile');
  if (mob) mob.addEventListener('click', toggleFn);
}

function updateThemeIcons(theme) {
  const icon = theme === 'dark'
    ? '<i class="bi bi-sun-fill"></i>'
    : '<i class="bi bi-moon-stars-fill"></i>';
  $('themeToggle').innerHTML = icon;
  const mob = $('themeToggleMobile');
  if (mob) mob.innerHTML = icon;
}

/* ── Sidebar (mobile) ────────────────────────────────── */
function initSidebar() {
  const sidebar  = document.getElementById('sidebar');
  const toggle   = $('sidebarToggle');
  if (!toggle) return;

  // Create overlay
  const overlay = document.createElement('div');
  overlay.className = 'sidebar-overlay';
  document.body.appendChild(overlay);

  toggle.addEventListener('click', () => {
    sidebar.classList.toggle('open');
    overlay.classList.toggle('show');
  });
  overlay.addEventListener('click', () => {
    sidebar.classList.remove('open');
    overlay.classList.remove('show');
  });
}

/* ── Tabs ─────────────────────────────────────────────── */
function initTabs() {
  document.querySelectorAll('[data-tab]').forEach(link => {
    link.addEventListener('click', e => {
      e.preventDefault();
      switchTab(link.dataset.tab);

      // Close mobile sidebar
      const sidebar = document.getElementById('sidebar');
      const overlay = document.querySelector('.sidebar-overlay');
      if (sidebar && overlay) {
        sidebar.classList.remove('open');
        overlay.classList.remove('show');
      }
    });
  });
}

function switchTab(tabId) {
  document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('[data-tab]').forEach(l => l.classList.remove('active'));

  const pane = $(`tab-${tabId}`);
  if (pane) pane.classList.add('active');

  document.querySelectorAll(`[data-tab="${tabId}"]`).forEach(l => l.classList.add('active'));
  state.currentTab = tabId;
}

/* ── Agent status check ──────────────────────────────── */
async function checkAgentStatus() {
  try {
    const res  = await fetch('/api/health-check');
    const data = await res.json();
    const dot  = document.querySelector('.status-dot');
    const txt  = document.querySelector('.status-text');

    if (data.watsonx_connected) {
      dot.classList.add('connected');
      if (txt) txt.textContent = 'Watsonx.ai ✓';
    } else {
      dot.classList.add('error');
      if (txt) txt.textContent = 'Demo mode';
    }

    // Update agent name
    if (data.agent) {
      const el = $('agentNameDisplay');
      if (el) el.textContent = data.agent;
    }
  } catch {
    const dot = document.querySelector('.status-dot');
    if (dot) dot.classList.add('error');
  }
}

/* ════════════════════════════════════════════════════════
   CHAT
   ════════════════════════════════════════════════════════ */
function initChat() {
  const input   = $('chatInput');
  const sendBtn = $('sendBtn');

  sendBtn.addEventListener('click', sendMessage);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  // Auto-resize textarea
  input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 120) + 'px';
  });

  // Quick prompts
  document.querySelectorAll('.quick-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      input.value = btn.dataset.prompt;
      sendMessage();
    });
  });

  // Clear chat
  $('clearChatBtn').addEventListener('click', () => {
    const msgs = $('chatMessages');
    msgs.innerHTML = '';
    state.chatHistory = [];
    addBotMessage('Chat cleared! How can I help you? 🥗');
    showToast('Conversation cleared', 'success');
  });
}

async function sendMessage() {
  const input = $('chatInput');
  const text  = input.value.trim();
  if (!text || state.isTyping) return;

  input.value = '';
  input.style.height = 'auto';

  // Hide quick prompts on first message
  const qp = $('quickPrompts');
  if (qp) qp.style.display = 'none';

  addUserMessage(text);
  showTypingIndicator();
  state.isTyping = true;
  $('sendBtn').disabled = true;

  try {
    const res = await fetch('/api/chat', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: text,
        profile: state.userProfile,
        history: state.chatHistory,
      }),
    });
    const data = await res.json();

    removeTypingIndicator();

    if (data.error) {
      addBotMessage('⚠️ ' + data.error);
    } else {
      addBotMessage(data.response, data.timestamp);
      state.chatHistory.push({ user: text, assistant: data.response });
      if (state.chatHistory.length > 20) state.chatHistory.shift();
    }
  } catch (err) {
    removeTypingIndicator();
    addBotMessage('⚠️ Network error. Please check your connection and try again.');
  } finally {
    state.isTyping = false;
    $('sendBtn').disabled = false;
    $('chatInput').focus();
  }
}

function addUserMessage(text) {
  const msgs = $('chatMessages');
  const div  = document.createElement('div');
  div.className = 'message user-message';
  div.innerHTML = `
    <div class="msg-avatar">👤</div>
    <div>
      <div class="msg-bubble">${escapeHtml(text)}</div>
      <div class="msg-time">${now()}</div>
    </div>`;
  msgs.appendChild(div);
  scrollChat();
}

function addBotMessage(text, time) {
  const msgs = $('chatMessages');
  const div  = document.createElement('div');
  div.className = 'message bot-message';
  div.innerHTML = `
    <div class="msg-avatar">🤖</div>
    <div>
      <div class="msg-bubble">${formatMarkdown(text)}</div>
      <div class="msg-time">${time || now()}</div>
    </div>`;
  msgs.appendChild(div);
  scrollChat();
}

function showTypingIndicator() {
  const msgs = $('chatMessages');
  const div  = document.createElement('div');
  div.id = 'typingIndicator';
  div.className = 'message bot-message typing-indicator';
  div.innerHTML = `
    <div class="msg-avatar">🤖</div>
    <div class="msg-bubble">
      <div class="typing-dot"></div>
      <div class="typing-dot"></div>
      <div class="typing-dot"></div>
    </div>`;
  msgs.appendChild(div);
  scrollChat();
}

function removeTypingIndicator() {
  const el = $('typingIndicator');
  if (el) el.remove();
}

function scrollChat() {
  const msgs = $('chatMessages');
  msgs.scrollTop = msgs.scrollHeight;
}

/* ════════════════════════════════════════════════════════
   DASHBOARD
   ════════════════════════════════════════════════════════ */
function initDashboard() {
  $('saveProfileBtn').addEventListener('click', saveProfile);
}

function saveProfile() {
  const name    = $('profileName').value.trim();
  const age     = parseInt($('profileAge').value);
  const gender  = $('profileGender').value;
  const weight  = parseFloat($('profileWeight').value);
  const height  = parseFloat($('profileHeight').value);
  const goal    = $('profileGoal').value;
  const diet    = $('profileDiet').value;
  const allerg  = $('profileAllergies').value.trim();

  if (!name || !age || !weight || !height) {
    showToast('Please fill in all required fields', 'warning');
    return;
  }

  state.userProfile = { name, age, gender, weight, height, goal, diet_type: diet, allergies: allerg };

  // Calculate and display stats
  calcAndShowStats(weight, height, age, gender, 'moderate', goal);
  showToast(`Profile saved for ${name}! 🎉`, 'success');
}

async function calcAndShowStats(weight, height, age, gender, activity, goal) {
  try {
    const res  = await fetch('/api/bmi', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ weight, height, age, gender, activity, goal }),
    });
    const data = await res.json();

    $('statBmi').textContent    = data.bmi;
    $('statBmiCat').textContent = data.category;
    $('statBmiCat').style.color = data.color;
    $('statTdee').textContent   = data.tdee.toLocaleString();
    $('statProtein').textContent = data.protein_g + 'g';
    $('statWater').textContent  = (Math.round(weight * 0.033 * 10) / 10) + 'L';

    $('statsRow').style.removeProperty('display');
    $('macroSection').style.removeProperty('display');

    renderMacroBars(data.protein_g, data.carbs_g, data.fat_g, data.tdee);
    renderCalorieRings(data.tdee, data.weight_loss, data.weight_gain);
  } catch (e) {
    showToast('Could not calculate stats', 'error');
  }
}

function renderMacroBars(protein, carbs, fat, tdee) {
  const macros = [
    { label: 'Protein', g: protein, kcal: protein * 4, color: '#f59e0b' },
    { label: 'Carbohydrates', g: carbs,   kcal: carbs   * 4, color: '#3b82f6' },
    { label: 'Fat',     g: fat,     kcal: fat     * 9, color: '#ef4444' },
  ];
  $('macroBars').innerHTML = macros.map(m => {
    const pct = Math.round((m.kcal / tdee) * 100);
    return `
      <div class="macro-bar-item">
        <div class="macro-bar-label">
          <span>${m.label}</span>
          <span>${m.g}g · ${pct}%</span>
        </div>
        <div class="macro-bar-track">
          <div class="macro-bar-fill" style="width:${pct}%;background:${m.color}"></div>
        </div>
      </div>`;
  }).join('');
}

function renderCalorieRings(tdee, loss, gain) {
  $('calorieRings').innerHTML = `
    <div class="cal-ring-item">
      <span class="cal-ring-label">🔥 Maintenance</span>
      <span class="cal-ring-value">${tdee.toLocaleString()} kcal</span>
    </div>
    <div class="cal-ring-item">
      <span class="cal-ring-label">📉 Weight Loss</span>
      <span class="cal-ring-value">${loss.toLocaleString()} kcal</span>
    </div>
    <div class="cal-ring-item">
      <span class="cal-ring-label">📈 Weight Gain</span>
      <span class="cal-ring-value">${gain.toLocaleString()} kcal</span>
    </div>`;
}

/* ════════════════════════════════════════════════════════
   BMI CALCULATOR
   ════════════════════════════════════════════════════════ */
function initBMI() {
  $('calculateBmiBtn').addEventListener('click', calculateBMI);
}

async function calculateBMI() {
  const weight   = parseFloat($('bmiWeight').value);
  const height   = parseFloat($('bmiHeight').value);
  const age      = parseInt($('bmiAge').value);
  const gender   = document.querySelector('input[name="bmiGender"]:checked')?.value || 'male';
  const activity = $('bmiActivity').value;
  const goal     = $('bmiGoal').value;

  if (!weight || !height || !age) {
    showToast('Please enter weight, height, and age', 'warning');
    return;
  }

  const btn = $('calculateBmiBtn');
  btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Calculating…';
  btn.disabled  = true;

  try {
    const res  = await fetch('/api/bmi', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ weight, height, age, gender, activity, goal }),
    });
    const data = await res.json();
    displayBMIResults(data);
  } catch {
    showToast('Calculation failed. Please try again.', 'error');
  } finally {
    btn.innerHTML = '<i class="bi bi-calculator"></i> Calculate';
    btn.disabled  = false;
  }
}

function displayBMIResults(data) {
  $('bmiResultsPanel').style.display = 'block';
  $('bmiResultsPanel').scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  $('bmiValueDisplay').textContent    = data.bmi;
  $('bmiValueDisplay').style.color    = data.color;
  $('bmiCategoryDisplay').textContent = data.category;
  $('bmiCategoryDisplay').style.color = data.color;

  $('resBmr').textContent     = data.bmr.toLocaleString();
  $('resTdee').textContent    = data.tdee.toLocaleString();
  $('resLoss').textContent    = data.weight_loss.toLocaleString();
  $('resGain').textContent    = data.weight_gain.toLocaleString();
  $('resProtein').textContent = data.protein_g + 'g';
}

/* ════════════════════════════════════════════════════════
   MEAL PLANNER
   ════════════════════════════════════════════════════════ */
function initMealPlanner() {
  $('generatePlanBtn').addEventListener('click', generateMealPlan);
  $('copyPlanBtn').addEventListener('click', () => copyText('mealPlanContent'));
}

async function generateMealPlan() {
  const days     = parseInt($('planDays').value);
  const diet     = $('planDiet').value;
  const calories = parseInt($('planCalories').value) || 2000;
  const goal     = $('planGoal').value;

  const profile = { ...state.userProfile, diet_type: diet, goal, calories };

  $('mealPlanOutput').style.display = 'none';
  $('mealPlanLoader').style.display = 'flex';

  const btn = $('generatePlanBtn');
  btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Generating…';
  btn.disabled  = true;

  try {
    const res  = await fetch('/api/meal-plan', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ days, profile }),
    });
    const data = await res.json();

    $('mealPlanLoader').style.display  = 'none';
    $('mealPlanOutput').style.display  = 'block';
    $('mealPlanContent').innerHTML     = formatMarkdown(data.plan);
    $('mealPlanOutput').scrollIntoView({ behavior: 'smooth' });
  } catch {
    $('mealPlanLoader').style.display = 'none';
    showToast('Failed to generate meal plan', 'error');
  } finally {
    btn.innerHTML = '<i class="bi bi-magic"></i> Generate';
    btn.disabled  = false;
  }
}

/* ════════════════════════════════════════════════════════
   FAMILY PROFILES
   ════════════════════════════════════════════════════════ */
function initFamilyProfiles() {
  $('addMemberBtn').addEventListener('click', addFamilyMember);
  $('genFamilyPlanBtn').addEventListener('click', generateFamilyPlan);
  $('copyFamilyBtn').addEventListener('click', () => copyText('familyPlanContent'));
}

function addFamilyMember() {
  const name   = $('famName').value.trim();
  const age    = parseInt($('famAge').value);
  const gender = $('famGender').value;
  const goal   = $('famGoal').value;
  const diet   = $('famDiet').value.trim();

  if (!name || !age) {
    showToast('Please enter name and age', 'warning');
    return;
  }
  if (state.familyMembers.length >= 8) {
    showToast('Maximum 8 family members allowed', 'warning');
    return;
  }

  const member = { name, age, gender, goal, diet, id: Date.now() };
  state.familyMembers.push(member);
  renderFamilyMembers();

  // Clear inputs
  $('famName').value = '';
  $('famAge').value  = '';
  $('famDiet').value = '';

  if (state.familyMembers.length > 0) $('genFamilyPlanBtn').style.display = 'block';
}

function renderFamilyMembers() {
  const emojis = { male: '👨', female: '👩' };
  const list   = $('familyMembersList');

  if (state.familyMembers.length === 0) {
    list.innerHTML = '<p class="text-muted text-center py-3">No family members added yet.</p>';
    $('genFamilyPlanBtn').style.display = 'none';
    return;
  }

  list.innerHTML = state.familyMembers.map(m => `
    <div class="member-card">
      <div class="member-avatar">${emojis[m.gender] || '🧑'}</div>
      <div class="member-info">
        <div class="member-name">${escapeHtml(m.name)}</div>
        <div class="member-meta">${m.age} yrs · ${m.gender} · ${m.goal.replace(/_/g,' ')}</div>
      </div>
      <button class="btn-remove-member" onclick="removeMember(${m.id})">
        <i class="bi bi-x-circle-fill"></i>
      </button>
    </div>`).join('');
}

function removeMember(id) {
  state.familyMembers = state.familyMembers.filter(m => m.id !== id);
  renderFamilyMembers();
}

async function generateFamilyPlan() {
  if (state.familyMembers.length === 0) {
    showToast('Add at least one family member', 'warning');
    return;
  }

  $('familyPlanOutput').style.display = 'none';
  $('familyPlanLoader').style.display = 'flex';

  const btn = $('genFamilyPlanBtn');
  btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Generating…';
  btn.disabled  = true;

  try {
    const res  = await fetch('/api/family-plan', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ members: state.familyMembers }),
    });
    const data = await res.json();

    $('familyPlanLoader').style.display  = 'none';
    $('familyPlanOutput').style.display  = 'block';
    $('familyPlanContent').innerHTML     = formatMarkdown(data.plan);
    $('familyPlanOutput').scrollIntoView({ behavior: 'smooth' });
  } catch {
    $('familyPlanLoader').style.display = 'none';
    showToast('Failed to generate family plan', 'error');
  } finally {
    btn.innerHTML = '<i class="bi bi-magic"></i> Generate Family Plan';
    btn.disabled  = false;
  }
}

/* ════════════════════════════════════════════════════════
   FOOD ANALYZER
   ════════════════════════════════════════════════════════ */
function initFoodAnalyzer() {
  $('analyzeFoodBtn').addEventListener('click', analyzeFood);
  $('copyAnalysisBtn').addEventListener('click', () => copyText('foodAnalysisContent'));

  $('foodItem').addEventListener('keydown', e => {
    if (e.key === 'Enter') analyzeFood();
  });

  document.querySelectorAll('.food-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      $('foodItem').value = chip.dataset.food;
      analyzeFood();
    });
  });
}

async function analyzeFood() {
  const food = $('foodItem').value.trim();
  const qty  = $('foodQty').value.trim() || '1 serving';

  if (!food) {
    showToast('Please enter a food item', 'warning');
    return;
  }

  $('foodAnalysisOutput').style.display = 'none';
  $('foodAnalysisLoader').style.display = 'flex';

  const btn = $('analyzeFoodBtn');
  btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Analysing…';
  btn.disabled  = true;

  try {
    const res  = await fetch('/api/analyze-food', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ food, quantity: qty }),
    });
    const data = await res.json();

    $('foodAnalysisLoader').style.display  = 'none';
    $('foodAnalysisOutput').style.display  = 'block';
    $('foodAnalysisContent').innerHTML     = formatMarkdown(data.analysis);
    $('foodAnalysisOutput').scrollIntoView({ behavior: 'smooth' });
  } catch {
    $('foodAnalysisLoader').style.display = 'none';
    showToast('Analysis failed. Please try again.', 'error');
  } finally {
    btn.innerHTML = '<i class="bi bi-search"></i> Analyze';
    btn.disabled  = false;
  }
}

/* ════════════════════════════════════════════════════════
   HELPERS
   ════════════════════════════════════════════════════════ */

/** Minimal Markdown → HTML converter */
function formatMarkdown(text) {
  if (!text) return '';
  return text
    // Bold
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    // Italic
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    // Headers
    .replace(/^### (.+)$/gm, '<h6 style="margin:.6em 0 .3em;font-weight:700;">$1</h6>')
    .replace(/^## (.+)$/gm,  '<h5 style="margin:.8em 0 .4em;font-weight:700;">$1</h5>')
    .replace(/^# (.+)$/gm,   '<h4 style="margin:1em 0 .4em;font-weight:700;">$1</h4>')
    // Unordered list items
    .replace(/^[\•\-\*] (.+)$/gm, '<li>$1</li>')
    // Wrap consecutive <li> in <ul>
    .replace(/((<li>.*<\/li>\n?)+)/g, '<ul style="padding-left:18px;margin:4px 0">$1</ul>')
    // Newlines → <br>
    .replace(/\n{2,}/g, '<br/><br/>')
    .replace(/\n/g, '<br/>');
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function now() {
  return new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
}

function copyText(elementId) {
  const el   = $(elementId);
  const text = el ? el.innerText : '';
  navigator.clipboard.writeText(text).then(() => {
    showToast('Copied to clipboard!', 'success');
  }).catch(() => {
    showToast('Copy failed', 'error');
  });
}

function showToast(message, type = 'info') {
  const toastEl = $('appToast');
  const toastMsg = $('toastMsg');
  if (!toastEl) return;

  const colors = {
    success: '#16a34a',
    warning: '#f59e0b',
    error:   '#ef4444',
    info:    '#0ea5e9',
  };
  toastEl.style.borderLeft = `4px solid ${colors[type] || colors.info}`;
  toastMsg.textContent = message;

  const toast = bootstrap.Toast.getOrCreateInstance(toastEl, { delay: 3000 });
  toast.show();
}
