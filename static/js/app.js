/* ─────────────────────────────────────────────────────────────────────────────
   Fitness Buddy · app.js
   IBM Watsonx.ai — AI Fitness Coach
───────────────────────────────────────────────────────────────────────────── */

/* ── State ──────────────────────────────────────────────────────────────── */
const state = {
  chatHistory: [],
  userProfile: null,
  familyMembers: [],
  currentTab: 'chat',
}

const $ = id => document.getElementById(id)

/* ── Boot ───────────────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  initTheme()
  initSidebar()
  initTabs()
  initChat()
  initDashboard()
  initWorkout()
  initNutrition()
  initHabits()
  initBMI()
  checkAgentStatus()
})

/* ── Theme ──────────────────────────────────────────────────────────────── */
function initTheme() {
  const saved = localStorage.getItem('fb-theme') || 'light'
  document.documentElement.setAttribute('data-theme', saved)
  updateThemeIcons(saved)

  ;[$('themeToggle'), $('themeToggleMobile')].forEach(btn => {
    if (!btn) return
    btn.addEventListener('click', () => {
      const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark'
      document.documentElement.setAttribute('data-theme', next)
      localStorage.setItem('fb-theme', next)
      updateThemeIcons(next)
    })
  })
}

function updateThemeIcons(theme) {
  const icon = theme === 'dark' ? 'bi-sun-fill' : 'bi-moon-stars-fill'
  document.querySelectorAll('.btn-theme-toggle i').forEach(i => {
    i.className = `bi ${icon}`
  })
}

/* ── Sidebar ────────────────────────────────────────────────────────────── */
function initSidebar() {
  const sidebar  = $('sidebar')
  const toggle   = $('sidebarToggle')
  let overlay    = document.querySelector('.sidebar-overlay')

  if (!overlay) {
    overlay = document.createElement('div')
    overlay.className = 'sidebar-overlay'
    document.body.appendChild(overlay)
  }

  const open  = () => { sidebar.classList.add('open');  overlay.classList.add('show') }
  const close = () => { sidebar.classList.remove('open'); overlay.classList.remove('show') }

  toggle?.addEventListener('click', open)
  overlay.addEventListener('click', close)
}

/* ── Tabs ───────────────────────────────────────────────────────────────── */
function initTabs() {
  document.querySelectorAll('.nav-link[data-tab]').forEach(link => {
    link.addEventListener('click', e => {
      e.preventDefault()
      switchTab(link.dataset.tab)
      // close mobile sidebar
      document.getElementById('sidebar').classList.remove('open')
      document.querySelector('.sidebar-overlay')?.classList.remove('show')
    })
  })
}

function switchTab(tabId) {
  document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'))
  document.querySelectorAll('.nav-link[data-tab]').forEach(l => l.classList.remove('active'))
  const pane = $(`tab-${tabId}`)
  if (pane) pane.classList.add('active')
  document.querySelector(`.nav-link[data-tab="${tabId}"]`)?.classList.add('active')
  state.currentTab = tabId
}

/* ── Agent status ───────────────────────────────────────────────────────── */
async function checkAgentStatus() {
  const dot  = $('connectionStatus').querySelector('.status-dot')
  const text = $('connectionStatus').querySelector('.status-text')
  try {
    const res  = await fetch('/api/health-check')
    const data = await res.json()
    if (data.watsonx_connected) {
      dot.classList.add('connected')
      text.textContent = 'Watsonx Connected'
    } else {
      text.textContent = 'Demo Mode'
    }
    if (data.agent) $('agentNameDisplay').textContent = data.agent
  } catch {
    dot.classList.add('error')
    text.textContent = 'Offline'
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   CHAT
══════════════════════════════════════════════════════════════════════════ */
function initChat() {
  $('sendBtn').addEventListener('click', sendMessage)
  $('clearChatBtn').addEventListener('click', () => {
    $('chatMessages').innerHTML = ''
    state.chatHistory = []
    showToast('Conversation cleared', 'info')
  })

  const input = $('chatInput')
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() }
  })
  input.addEventListener('input', () => {
    input.style.height = 'auto'
    input.style.height = Math.min(input.scrollHeight, 120) + 'px'
  })

  document.querySelectorAll('.quick-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      input.value = btn.dataset.prompt
      sendMessage()
      $('quickPrompts').style.display = 'none'
    })
  })
}

async function sendMessage() {
  const input = $('chatInput')
  const text  = input.value.trim()
  if (!text) return

  addUserMessage(text)
  input.value = ''
  input.style.height = 'auto'
  $('sendBtn').disabled = true
  $('quickPrompts').style.display = 'none'

  const typing = showTypingIndicator()

  try {
    const res  = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: text,
        profile: state.userProfile,
        history: state.chatHistory,
      }),
    })
    const data = await res.json()
    removeTypingIndicator(typing)

    if (data.error) {
      addBotMessage(`⚠️ ${data.error}`, now())
    } else {
      addBotMessage(data.response, data.timestamp)
      state.chatHistory.push({ user: text, assistant: data.response })
      if (state.chatHistory.length > 20) state.chatHistory.shift()
    }
  } catch (err) {
    removeTypingIndicator(typing)
    addBotMessage('⚠️ Network error. Please check your connection.', now())
  }

  $('sendBtn').disabled = false
}

function addUserMessage(text) {
  const div = document.createElement('div')
  div.className = 'message user-message'
  div.innerHTML = `
    <div class="msg-avatar">🧑</div>
    <div>
      <div class="msg-bubble">${escapeHtml(text)}</div>
      <div class="msg-time">${now()}</div>
    </div>`
  $('chatMessages').appendChild(div)
  scrollChat()
}

function addBotMessage(text, time) {
  const div = document.createElement('div')
  div.className = 'message bot-message'
  div.innerHTML = `
    <div class="msg-avatar">🤖</div>
    <div>
      <div class="msg-bubble">${formatMarkdown(text)}</div>
      <div class="msg-time">${time || now()}</div>
    </div>`
  $('chatMessages').appendChild(div)
  scrollChat()
}

function showTypingIndicator() {
  const div = document.createElement('div')
  div.className = 'message bot-message typing-indicator'
  div.innerHTML = `
    <div class="msg-avatar">🤖</div>
    <div class="msg-bubble">
      <span class="typing-dot"></span>
      <span class="typing-dot"></span>
      <span class="typing-dot"></span>
    </div>`
  $('chatMessages').appendChild(div)
  scrollChat()
  return div
}

function removeTypingIndicator(el) { el?.remove() }
function scrollChat() {
  const c = $('chatMessages')
  c.scrollTop = c.scrollHeight
}

/* ══════════════════════════════════════════════════════════════════════════
   DASHBOARD
══════════════════════════════════════════════════════════════════════════ */
function initDashboard() {
  $('saveProfileBtn').addEventListener('click', saveProfile)
  $('refreshMotivation').addEventListener('click', loadMotivation)
  loadMotivation()
}

async function loadMotivation() {
  const el = $('motivationText')
  el.textContent = 'Loading your daily fitness inspiration…'
  try {
    const res  = await fetch('/api/motivation')
    const data = await res.json()
    el.innerHTML = formatMarkdown(data.motivation || 'Stay consistent — every rep counts! 💪')
  } catch {
    el.textContent = '💪 "Every workout is a step closer to your goals. Keep going!"'
  }
}

function saveProfile() {
  const name   = $('profileName').value.trim()
  const age    = parseInt($('profileAge').value)
  const gender = $('profileGender').value
  const weight = parseFloat($('profileWeight').value)
  const height = parseFloat($('profileHeight').value)
  const goal   = $('profileGoal').value
  const level  = $('profileFitnessLevel').value
  const equip  = $('profileEquipment').value
  const time   = parseInt($('profileTime').value) || 30

  if (!name || !age || !weight || !height) {
    showToast('Please fill in all required fields', 'warning')
    return
  }

  state.userProfile = { name, age, gender, weight, height, goal, fitness_level: level, equipment: equip, time_available: time }
  showToast(`Profile saved for ${name}! 💪`, 'success')
  calcAndShowStats(weight, height, age, gender, 'moderate', goal)
}

async function calcAndShowStats(weight, height, age, gender, activity, goal) {
  try {
    const res  = await fetch('/api/bmi', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ weight, height, age, gender, activity, goal }),
    })
    const d = await res.json()
    if (d.error) return

    $('statBmi').textContent    = d.bmi
    $('statBmiCat').textContent = d.category
    $('statTdee').textContent   = d.tdee
    $('statProtein').textContent = d.protein_g + 'g'
    $('statWater').textContent  = (weight * 0.033).toFixed(1) + 'L'

    $('statsRow').style.removeProperty('display')
    $('macroSection').style.removeProperty('display')

    renderMacroBars(d.protein_g, d.carbs_g, d.fat_g, d.tdee)
    renderCalorieRings(d.tdee, d.weight_loss, d.weight_gain)
  } catch {}
}

function renderMacroBars(protein, carbs, fat, tdee) {
  const total = protein * 4 + carbs * 4 + fat * 9
  const bars = [
    { label: 'Protein', value: protein, unit: 'g', kcal: protein * 4, color: '#0f62fe' },
    { label: 'Carbs',   value: carbs,   unit: 'g', kcal: carbs * 4,   color: '#ff832b' },
    { label: 'Fat',     value: fat,     unit: 'g', kcal: fat * 9,     color: '#24a148' },
  ]
  $('macroBars').innerHTML = bars.map(b => `
    <div class="macro-bar-item">
      <div class="macro-bar-label">
        <span>${b.label} <strong>${b.value}${b.unit}</strong></span>
        <span>${b.kcal} kcal</span>
      </div>
      <div class="macro-bar-track">
        <div class="macro-bar-fill" style="width:${Math.round(b.kcal/total*100)}%; background:${b.color}"></div>
      </div>
    </div>`).join('')
}

function renderCalorieRings(tdee, loss, gain) {
  $('calorieRings').innerHTML = [
    { label: 'Maintenance', value: tdee, color: '#0f62fe' },
    { label: 'Weight Loss',  value: loss, color: '#ff832b' },
    { label: 'Weight Gain',  value: gain, color: '#24a148' },
  ].map(r => `
    <div class="cal-ring-item">
      <div class="cal-ring-label" style="color:${r.color}">${r.label}</div>
      <div class="cal-ring-value">${r.value}</div>
      <small style="color:var(--text-muted);font-size:.7rem">kcal/day</small>
    </div>`).join('')
}

/* ══════════════════════════════════════════════════════════════════════════
   WORKOUT PLANNER
══════════════════════════════════════════════════════════════════════════ */
function initWorkout() {
  $('generateWorkoutBtn').addEventListener('click', generateWorkout)
  $('copyWorkoutBtn').addEventListener('click', () => copyText('workoutContent'))
}

async function generateWorkout() {
  const level    = $('workoutLevel').value
  const focus    = $('workoutFocus').value
  const duration = $('workoutDuration').value
  const equip    = $('workoutEquipment').value
  const goal     = $('workoutGoal').value

  $('workoutOutput').style.display = 'none'
  $('workoutLoader').style.display = 'flex'

  try {
    const res  = await fetch('/api/workout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fitness_level: level, focus, duration: parseInt(duration), equipment: equip, goal }),
    })
    const data = await res.json()
    $('workoutContent').innerHTML = formatMarkdown(data.workout || 'Could not generate workout.')
    $('workoutOutput').style.display = 'block'
  } catch {
    showToast('Failed to generate workout. Please try again.', 'error')
  }

  $('workoutLoader').style.display = 'none'
}

/* ══════════════════════════════════════════════════════════════════════════
   NUTRITION
══════════════════════════════════════════════════════════════════════════ */
function initNutrition() {
  $('generatePlanBtn').addEventListener('click', generateMealPlan)
  $('copyPlanBtn').addEventListener('click', () => copyText('mealPlanContent'))
  $('analyzeFoodBtn').addEventListener('click', analyzeFood)
  $('copyAnalysisBtn').addEventListener('click', () => copyText('foodAnalysisContent'))

  $('foodItem').addEventListener('keydown', e => {
    if (e.key === 'Enter') analyzeFood()
  })

  document.querySelectorAll('.food-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      $('foodItem').value = chip.dataset.food
      analyzeFood()
    })
  })
}

async function generateMealPlan() {
  const profile = {
    goal:      $('planGoal').value,
    diet_type: $('planDiet').value,
    calories:  parseInt($('planCalories').value) || 2000,
  }

  $('mealPlanOutput').style.display = 'none'
  $('mealPlanLoader').style.display = 'flex'

  try {
    const res  = await fetch('/api/meal-plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profile, days: parseInt($('planDays').value) }),
    })
    const data = await res.json()
    $('mealPlanContent').innerHTML = formatMarkdown(data.plan || 'Could not generate plan.')
    $('mealPlanOutput').style.display = 'block'
  } catch {
    showToast('Failed to generate meal plan. Please try again.', 'error')
  }

  $('mealPlanLoader').style.display = 'none'
}

async function analyzeFood() {
  const food = $('foodItem').value.trim()
  const qty  = $('foodQty').value.trim() || '1 serving'
  if (!food) { showToast('Please enter a food item', 'warning'); return }

  $('foodAnalysisOutput').style.display = 'none'
  $('foodAnalysisLoader').style.display = 'flex'

  try {
    const res  = await fetch('/api/analyze-food', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ food, quantity: qty }),
    })
    const data = await res.json()
    if (data.error) { showToast(data.error, 'error'); return }
    $('foodAnalysisContent').innerHTML = formatMarkdown(data.analysis || 'No analysis available.')
    $('foodAnalysisOutput').style.display = 'block'
  } catch {
    showToast('Failed to analyze food. Please try again.', 'error')
  }

  $('foodAnalysisLoader').style.display = 'none'
}

/* ══════════════════════════════════════════════════════════════════════════
   HABIT BUILDER
══════════════════════════════════════════════════════════════════════════ */
function initHabits() {
  $('generateHabitsBtn').addEventListener('click', generateHabits)
  $('copyHabitsBtn').addEventListener('click', () => copyText('habitsContent'))
}

async function generateHabits() {
  const level = $('habitLevel').value
  const goals = Array.from(
    document.querySelectorAll('#habitGoalCheckboxes input:checked')
  ).map(cb => cb.value)

  if (goals.length === 0) {
    showToast('Please select at least one goal', 'warning')
    return
  }

  $('habitsOutput').style.display = 'none'
  $('habitsLoader').style.display = 'flex'

  try {
    const res  = await fetch('/api/habits', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ goals, fitness_level: level }),
    })
    const data = await res.json()
    $('habitsContent').innerHTML = formatMarkdown(data.habits || 'Could not generate plan.')
    $('habitsOutput').style.display = 'block'
  } catch {
    showToast('Failed to generate habit plan. Please try again.', 'error')
  }

  $('habitsLoader').style.display = 'none'
}

/* ══════════════════════════════════════════════════════════════════════════
   BMI CALCULATOR
══════════════════════════════════════════════════════════════════════════ */
function initBMI() {
  $('calculateBmiBtn').addEventListener('click', calculateBMI)
}

async function calculateBMI() {
  const weight   = parseFloat($('bmiWeight').value)
  const height   = parseFloat($('bmiHeight').value)
  const age      = parseInt($('bmiAge').value)
  const gender   = document.querySelector('input[name="bmiGender"]:checked')?.value || 'male'
  const activity = $('bmiActivity').value
  const goal     = $('bmiGoal').value

  if (!weight || !height || !age) {
    showToast('Please fill in all measurements', 'warning')
    return
  }

  $('calculateBmiBtn').disabled = true
  $('calculateBmiBtn').textContent = 'Calculating…'

  try {
    const res  = await fetch('/api/bmi', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ weight, height, age, gender, activity, goal }),
    })
    const data = await res.json()
    if (data.error) { showToast(data.error, 'error'); return }
    displayBMIResults(data)
  } catch {
    showToast('Calculation failed. Please try again.', 'error')
  }

  $('calculateBmiBtn').disabled = false
  $('calculateBmiBtn').innerHTML = '<i class="bi bi-calculator"></i> Calculate'
}

function displayBMIResults(data) {
  $('bmiResultsPanel').style.display = 'block'
  $('bmiValueDisplay').textContent  = data.bmi
  $('bmiCategoryDisplay').textContent = data.category
  $('bmiCategoryDisplay').style.color = data.color
  $('bmiGauge').style.borderColor = data.color

  $('resBmr').textContent     = data.bmr
  $('resTdee').textContent    = data.tdee
  $('resLoss').textContent    = data.weight_loss
  $('resGain').textContent    = data.weight_gain
  $('resProtein').textContent = data.protein_g + 'g'

  $('bmiResultsPanel').scrollIntoView({ behavior: 'smooth', block: 'nearest' })
}

/* ══════════════════════════════════════════════════════════════════════════
   UTILITIES
══════════════════════════════════════════════════════════════════════════ */
function formatMarkdown(text) {
  if (!text) return ''
  return text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/^#{1,3} (.+)$/gm, '<strong>$1</strong>')
    .replace(/^[\*\-] (.+)$/gm, '• $1')
    .replace(/\n/g, '<br>')
}

function escapeHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
            .replace(/"/g,'&quot;').replace(/'/g,'&#039;')
}

function now() {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function copyText(elementId) {
  const el   = $(elementId)
  const text = el?.innerText || el?.textContent
  if (!text) return
  navigator.clipboard.writeText(text).then(() => showToast('Copied to clipboard!', 'success'))
}

function showToast(message, type = 'info') {
  const toast   = $('appToast')
  const toastEl = $('toastMsg')
  toastEl.textContent = message

  toast.className = 'toast align-items-center border-0'
  const colours = { success: 'text-bg-success', error: 'text-bg-danger', warning: 'text-bg-warning', info: 'text-bg-primary' }
  toast.classList.add(colours[type] || 'text-bg-primary')

  const bsToast = bootstrap.Toast.getOrCreateInstance(toast, { delay: 3000 })
  bsToast.show()
}
