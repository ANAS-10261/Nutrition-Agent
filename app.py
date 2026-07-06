"""
╔══════════════════════════════════════════════════════════════════════════════╗
║           IBM Watsonx.ai  ·  Fitness Buddy  ·  app.py                       ║
╚══════════════════════════════════════════════════════════════════════════════╝

AGENT_INSTRUCTIONS
==================
Customize the agent's personality, tone, and safety rules here.
All keys are read at runtime — no restart required for .env changes, but
editing this section does require a server restart.

  AGENT_NAME      : Display name shown in the chat UI
  AGENT_TONE      : "friendly" | "professional" | "motivational" | "clinical"
  LANGUAGE_STYLE  : "simple" | "detailed" | "scientific"
  SAFETY_RULES    : List of hard rules the model must never violate
  DISCLAIMER      : Appended to every exercise / medical answer
"""

# ── Standard library ──────────────────────────────────────────────────────────
import os
import json
import math
import logging
from datetime import datetime
from functools import wraps

# ── Third-party ───────────────────────────────────────────────────────────────
from flask import Flask, request, jsonify, render_template, session
from flask_cors import CORS
from dotenv import load_dotenv
import requests as http_requests

# ── Load environment variables ────────────────────────────────────────────────
load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), ".env"), override=True)

# ─────────────────────────────────────────────────────────────────────────────
# AGENT CONFIGURATION  (edit freely)
# ─────────────────────────────────────────────────────────────────────────────
AGENT_INSTRUCTIONS = {
    "AGENT_NAME": "Fitness Buddy",
    "AGENT_TONE": "motivational",
    "LANGUAGE_STYLE": "simple",
    "RESPONSE_LANGUAGE": "english",

    # Hard safety rules injected into every system prompt
    "SAFETY_RULES": [
        "Never prescribe medication or replace a licensed physician.",
        "Always recommend consulting a doctor before starting a new exercise program.",
        "Do not provide advice that promotes extreme caloric restriction (< 1000 kcal/day).",
        "Do not recommend exercises that could cause injury without proper supervision.",
        "Flag any query about eating disorders or self-harm with a helpline suggestion.",
        "Keep all responses evidence-based and grounded in established fitness science.",
    ],

    # Appended to every exercise / medical response
    "DISCLAIMER": (
        "⚠️ Always consult a healthcare professional before starting a new fitness program, "
        "especially if you have any pre-existing medical conditions."
    ),

    # Core personality block
    "PERSONALITY": (
        "You are Fitness Buddy, a warm, energetic, and knowledgeable AI-powered fitness coach. "
        "You specialise in home workouts, bodyweight training, healthy nutrition, habit building, "
        "and daily motivation. You speak like an encouraging personal trainer — positive, practical, "
        "and never judgemental. You adapt advice to the user's fitness level, available equipment, "
        "and time constraints. You celebrate small wins and keep people consistent. "
        "Powered by IBM Watsonx.ai."
    ),
}
# ─────────────────────────────────────────────────────────────────────────────

# ── Logging ───────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger(__name__)

# ── Flask app ─────────────────────────────────────────────────────────────────
app = Flask(__name__)
app.secret_key = os.getenv("FLASK_SECRET_KEY", os.urandom(24).hex())
CORS(app)

# ── IBM Watsonx.ai credentials ────────────────────────────────────────────────
IBM_API_KEY    = os.getenv("IBM_API_KEY")
IBM_PROJECT_ID = os.getenv("IBM_PROJECT_ID")
IBM_URL        = os.getenv("IBM_URL", "https://us-south.ml.cloud.ibm.com")

WATSONX_MODEL_ID = "meta-llama/llama-3-3-70b-instruct"

# IAM token cache
_iam_token: str | None = None
_iam_token_expiry: float = 0.0


def _get_iam_token() -> str:
    """Fetch (or return cached) IAM bearer token from IBM Cloud."""
    import time
    global _iam_token, _iam_token_expiry
    if _iam_token and time.time() < _iam_token_expiry:
        return _iam_token
    resp = http_requests.post(
        "https://iam.cloud.ibm.com/identity/token",
        data={"grant_type": "urn:ibm:params:oauth:grant-type:apikey", "apikey": IBM_API_KEY},
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        timeout=30,
    )
    resp.raise_for_status()
    data = resp.json()
    _iam_token = data["access_token"]
    _iam_token_expiry = time.time() + data.get("expires_in", 3600) - 60
    return _iam_token


_watsonx_ready = False


def init_watsonx():
    """Verify credentials by fetching an IAM token."""
    global _watsonx_ready
    if not IBM_API_KEY or not IBM_PROJECT_ID:
        logger.warning("IBM_API_KEY or IBM_PROJECT_ID not set. Running in demo mode.")
        return False
    try:
        _get_iam_token()
        _watsonx_ready = True
        logger.info("Watsonx.ai ready. URL=%s Model=%s", IBM_URL, WATSONX_MODEL_ID)
        return True
    except Exception as exc:
        logger.error("Watsonx.ai init failed: %s", exc)
        return False


# ── System prompt builder ─────────────────────────────────────────────────────

def build_system_prompt(user_profile: dict | None = None) -> str:
    ai = AGENT_INSTRUCTIONS
    rules = "\n".join(f"  • {r}" for r in ai["SAFETY_RULES"])

    profile_block = ""
    if user_profile:
        profile_block = f"""
Current user profile:
  Name            : {user_profile.get('name', 'User')}
  Age             : {user_profile.get('age', 'N/A')}
  Gender          : {user_profile.get('gender', 'N/A')}
  Weight          : {user_profile.get('weight', 'N/A')} kg
  Height          : {user_profile.get('height', 'N/A')} cm
  Fitness Level   : {user_profile.get('fitness_level', 'beginner')}
  Goal            : {user_profile.get('goal', 'general fitness')}
  Equipment       : {user_profile.get('equipment', 'none (home workout)')}
  Available Time  : {user_profile.get('time_available', '30')} minutes/day
  Health Conditions: {user_profile.get('health_conditions', 'None')}
"""

    prompt = f"""{ai['PERSONALITY']}

Tone       : {ai['AGENT_TONE']}
Style      : {ai['LANGUAGE_STYLE']}
Language   : {ai['RESPONSE_LANGUAGE']}

Safety Rules (NEVER violate):
{rules}

{profile_block}

Format responses with:
- Clear headings using **bold**
- Numbered steps for exercises and routines
- Bullet points for tips and lists
- 💪 fitness emojis where appropriate
- Practical, actionable advice
- Always end exercise/medical answers with: {ai['DISCLAIMER']}
"""
    return prompt.strip()


# ── AI generation helpers ─────────────────────────────────────────────────────

def generate_ai_response(user_message: str, user_profile: dict | None = None,
                          chat_history: list | None = None) -> str:
    """Call Watsonx.ai via direct REST."""
    if not _watsonx_ready:
        return _demo_response(user_message)

    system_prompt = build_system_prompt(user_profile)
    messages = [{"role": "system", "content": system_prompt}]
    if chat_history:
        for turn in chat_history[-6:]:
            messages.append({"role": "user",      "content": turn["user"]})
            messages.append({"role": "assistant",  "content": turn["assistant"]})
    messages.append({"role": "user", "content": user_message})

    try:
        token = _get_iam_token()
        url = f"{IBM_URL}/ml/v1/text/chat?version=2024-05-01"
        payload = {
            "model_id": WATSONX_MODEL_ID,
            "project_id": IBM_PROJECT_ID,
            "messages": messages,
            "parameters": {
                "max_new_tokens": 1024,
                "temperature": 0.7,
                "top_p": 0.9,
                "repetition_penalty": 1.1,
            },
        }
        resp = http_requests.post(
            url,
            json=payload,
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
            timeout=60,
        )
        resp.raise_for_status()
        content = resp.json()["choices"][0]["message"]["content"]
        return content.strip() if content else "I couldn't generate a response. Please try again."
    except Exception as exc:
        logger.error("Generation error: %s", exc)
        return f"AI service temporarily unavailable. Error: {str(exc)[:120]}"


def _demo_response(message: str) -> str:
    """Fallback when Watsonx.ai is not configured."""
    msg = message.lower()
    if any(w in msg for w in ["workout", "exercise", "routine", "train"]):
        return ("**Sample Home Workout (Demo Mode)**\n\n"
                "💪 **30-Minute Full Body Routine:**\n\n"
                "1. Jumping Jacks — 3×30 (warm-up)\n"
                "2. Push-Ups — 3×12\n"
                "3. Bodyweight Squats — 3×15\n"
                "4. Plank Hold — 3×30 sec\n"
                "5. Mountain Climbers — 3×20\n"
                "6. Lunges — 3×10 each leg\n\n"
                "🔧 *Configure IBM_API_KEY in .env for personalised AI workouts.*")
    if any(w in msg for w in ["motivat", "inspire", "tip", "quote"]):
        return ("🌟 **Daily Fitness Motivation (Demo Mode)**\n\n"
                "*\"Every workout is progress, no matter how small. Show up today — your future self will thank you.\"*\n\n"
                "💡 **Tip:** Consistency beats intensity. A 20-minute workout you actually do is better than a 2-hour workout you skip.\n\n"
                "🔧 *Configure IBM_API_KEY in .env for AI-powered daily motivation.*")
    if any(w in msg for w in ["meal", "nutrition", "eat", "food", "diet"]):
        return ("**Simple Fitness Nutrition (Demo Mode)**\n\n"
                "🥗 **Pre-Workout:** Banana + peanut butter toast\n"
                "💪 **Post-Workout:** Greek yogurt + berries + granola\n"
                "🍽️ **Lunch:** Grilled chicken/paneer + brown rice + veggies\n"
                "🌙 **Dinner:** Lentil soup + whole grain bread + salad\n\n"
                "🔧 *Configure IBM_API_KEY in .env for personalised AI nutrition plans.*")
    return ("👋 Hi! I'm **Fitness Buddy** (Demo Mode).\n\n"
            "I can help with:\n"
            "• 🏋️ Personalised home workout routines\n"
            "• 🌟 Daily motivation & fitness tips\n"
            "• 🥗 Nutrition & meal guidance\n"
            "• ⚖️ BMI & calorie calculations\n"
            "• 📅 Habit building & consistency\n\n"
            "🔧 *Add your IBM_API_KEY to .env to unlock full AI capabilities.*")


# ── BMI & Nutrition Calculators ───────────────────────────────────────────────

def calculate_bmi(weight_kg: float, height_cm: float) -> dict:
    height_m = height_cm / 100
    bmi = round(weight_kg / (height_m ** 2), 1)
    if bmi < 18.5:
        category, color = "Underweight", "#3b82f6"
    elif bmi < 25:
        category, color = "Normal weight", "#22c55e"
    elif bmi < 30:
        category, color = "Overweight", "#f59e0b"
    else:
        category, color = "Obese", "#ef4444"
    return {"bmi": bmi, "category": category, "color": color}


def calculate_tdee(weight_kg: float, height_cm: float, age: int,
                   gender: str, activity: str) -> dict:
    """Calculate BMR (Mifflin-St Jeor) and TDEE."""
    if gender.lower() == "female":
        bmr = 10 * weight_kg + 6.25 * height_cm - 5 * age - 161
    else:
        bmr = 10 * weight_kg + 6.25 * height_cm - 5 * age + 5

    multipliers = {
        "sedentary": 1.2, "light": 1.375,
        "moderate": 1.55, "active": 1.725, "very_active": 1.9,
    }
    factor = multipliers.get(activity, 1.55)
    tdee = round(bmr * factor)
    return {
        "bmr": round(bmr), "tdee": tdee,
        "weight_loss": tdee - 500, "weight_gain": tdee + 300,
    }


def calculate_macros(tdee: int, goal: str) -> dict:
    """Return gram targets for protein, carbs, fat."""
    targets = {
        "weight_loss":    {"protein": 0.35, "carbs": 0.35, "fat": 0.30},
        "weight_gain":    {"protein": 0.30, "carbs": 0.45, "fat": 0.25},
        "muscle_gain":    {"protein": 0.40, "carbs": 0.40, "fat": 0.20},
        "maintenance":    {"protein": 0.25, "carbs": 0.50, "fat": 0.25},
        "general_fitness":{"protein": 0.25, "carbs": 0.50, "fat": 0.25},
    }
    ratios = targets.get(goal.lower().replace(" ", "_"), targets["general_fitness"])
    return {
        "protein_g": round((tdee * ratios["protein"]) / 4),
        "carbs_g":   round((tdee * ratios["carbs"])   / 4),
        "fat_g":     round((tdee * ratios["fat"])     / 9),
    }


# ── Flask Routes ──────────────────────────────────────────────────────────────

@app.route("/")
def index():
    return render_template("index.html", agent_name=AGENT_INSTRUCTIONS["AGENT_NAME"])


@app.route("/api/chat", methods=["POST"])
def chat():
    data = request.get_json(silent=True) or {}
    user_message = data.get("message", "").strip()
    user_profile = data.get("profile")
    chat_history = data.get("history", [])

    if not user_message:
        return jsonify({"error": "Message is required"}), 400

    logger.info("Chat request: %s…", user_message[:60])
    response = generate_ai_response(user_message, user_profile, chat_history)
    return jsonify({
        "response": response,
        "timestamp": datetime.now().strftime("%H:%M"),
        "agent": AGENT_INSTRUCTIONS["AGENT_NAME"],
    })


@app.route("/api/workout", methods=["POST"])
def workout():
    data = request.get_json(silent=True) or {}
    fitness_level = data.get("fitness_level", "beginner")
    goal          = data.get("goal", "general fitness")
    duration      = data.get("duration", 30)
    equipment     = data.get("equipment", "none")
    focus         = data.get("focus", "full body")

    prompt = (
        f"Create a detailed {duration}-minute home workout routine for:\n"
        f"Fitness Level : {fitness_level}\n"
        f"Goal          : {goal}\n"
        f"Equipment     : {equipment}\n"
        f"Focus Area    : {focus}\n\n"
        "Include:\n"
        "1. Warm-up (5 min) with specific exercises\n"
        "2. Main workout with sets, reps, and rest times\n"
        "3. Cool-down / stretch (5 min)\n"
        "4. Calories burned estimate\n"
        "5. Modification tips for beginners and advanced users\n"
        "Format clearly with numbered steps and bold section headers."
    )
    response = generate_ai_response(prompt)
    return jsonify({"workout": response, "duration": duration, "focus": focus})


@app.route("/api/motivation", methods=["GET"])
def motivation():
    import random
    themes = [
        "starting a new fitness journey",
        "staying consistent when motivation is low",
        "celebrating small fitness wins",
        "overcoming a workout plateau",
        "building a healthy morning routine",
        "the importance of rest and recovery",
        "mental strength and fitness mindset",
    ]
    theme = random.choice(themes)
    prompt = (
        f"Give me a powerful, uplifting fitness motivation message about: {theme}\n\n"
        "Include:\n"
        "1. An inspiring quote (original or well-known)\n"
        "2. A brief motivational paragraph (3-4 sentences)\n"
        "3. One actionable tip for today\n"
        "Keep it energetic, positive, and practical. Use emojis sparingly but effectively."
    )
    response = generate_ai_response(prompt)
    return jsonify({"motivation": response, "theme": theme})


@app.route("/api/meal-plan", methods=["POST"])
def meal_plan():
    data    = request.get_json(silent=True) or {}
    profile = data.get("profile", {})
    days    = min(int(data.get("days", 7)), 7)

    prompt = (
        f"Generate a {days}-day fitness meal plan for:\n"
        f"Goal      : {profile.get('goal', 'general fitness')}\n"
        f"Diet      : {profile.get('diet_type', 'balanced')}\n"
        f"Calories/day: {profile.get('calories', 2000)} kcal\n"
        f"Allergies : {profile.get('allergies', 'none')}\n\n"
        "Format: Day-wise with Breakfast, Pre-Workout Snack, Lunch, Post-Workout Snack, Dinner. "
        "Include calorie and protein estimates per meal. "
        "Focus on whole foods that support energy, recovery, and fitness performance."
    )
    response = generate_ai_response(prompt, profile)
    return jsonify({"plan": response, "days": days})


@app.route("/api/analyze-food", methods=["POST"])
def analyze_food():
    data      = request.get_json(silent=True) or {}
    food_item = data.get("food", "").strip()
    quantity  = data.get("quantity", "1 serving")

    if not food_item:
        return jsonify({"error": "Food item required"}), 400

    prompt = (
        f"Provide a detailed nutritional analysis for: {quantity} of {food_item}\n\n"
        "Include:\n"
        "1. Calories and macronutrients (protein, carbs, fat, fiber)\n"
        "2. Key vitamins and minerals\n"
        "3. Fitness benefits — is it good pre/post workout?\n"
        "4. Glycemic index (if applicable)\n"
        "5. Healthy preparation tips\n"
        "Keep it concise and fitness-focused."
    )
    response = generate_ai_response(prompt)
    return jsonify({"analysis": response, "food": food_item, "quantity": quantity})


@app.route("/api/habits", methods=["POST"])
def habits():
    data  = request.get_json(silent=True) or {}
    goals = data.get("goals", ["general fitness"])
    level = data.get("fitness_level", "beginner")

    goals_str = ", ".join(goals) if isinstance(goals, list) else goals
    prompt = (
        f"Create a practical 30-day habit-building plan for someone who wants to: {goals_str}\n"
        f"Their current fitness level is: {level}\n\n"
        "Include:\n"
        "1. Week 1: Foundation habits (easy wins to build momentum)\n"
        "2. Week 2: Expanding the routine\n"
        "3. Week 3: Increasing intensity\n"
        "4. Week 4: Making it a lifestyle\n"
        "5. Daily habit checklist (5-7 habits max)\n"
        "6. Tips for staying consistent when life gets busy\n"
        "Keep it realistic, encouraging, and actionable."
    )
    response = generate_ai_response(prompt)
    return jsonify({"habits": response, "goals": goals_str})


@app.route("/api/bmi", methods=["POST"])
def bmi_endpoint():
    data = request.get_json(silent=True) or {}
    try:
        weight   = float(data["weight"])
        height   = float(data["height"])
        age      = int(data.get("age", 30))
        gender   = data.get("gender", "male")
        activity = data.get("activity", "moderate")
        goal     = data.get("goal", "general_fitness")
    except (KeyError, ValueError) as exc:
        return jsonify({"error": f"Invalid input: {exc}"}), 400

    bmi_result  = calculate_bmi(weight, height)
    tdee_result = calculate_tdee(weight, height, age, gender, activity)
    macros      = calculate_macros(tdee_result["tdee"], goal)
    return jsonify({**bmi_result, **tdee_result, **macros})


@app.route("/api/health-check", methods=["GET"])
def health_check():
    return jsonify({
        "status": "running",
        "agent": AGENT_INSTRUCTIONS["AGENT_NAME"],
        "watsonx_connected": _watsonx_ready,
        "timestamp": datetime.now().isoformat(),
    })


@app.route("/api/agent-config", methods=["GET"])
def agent_config():
    safe_keys = ["AGENT_NAME", "AGENT_TONE", "LANGUAGE_STYLE",
                 "RESPONSE_LANGUAGE", "PERSONALITY"]
    return jsonify({k: AGENT_INSTRUCTIONS[k] for k in safe_keys})


# ── Initialise Watsonx on startup ─────────────────────────────────────────────
init_watsonx()

# ── Entry point ───────────────────────────────────────────────────────────────
if __name__ == "__main__":
    port  = int(os.getenv("PORT", 5000))
    debug = os.getenv("FLASK_DEBUG", "false").lower() == "true"
    logger.info("Fitness Buddy starting on http://0.0.0.0:%d", port)
    app.run(host="0.0.0.0", port=port, debug=debug)
