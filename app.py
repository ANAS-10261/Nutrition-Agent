"""
╔══════════════════════════════════════════════════════════════════════════════╗
║               IBM Watsonx.ai  ·  Nutrition Agent  ·  app.py                 ║
╚══════════════════════════════════════════════════════════════════════════════╝

AGENT_INSTRUCTIONS
==================
Customize the agent's personality, tone, specialization, and safety rules here.
All keys are read at runtime — no restart required for .env changes, but
editing this section does require a server restart.

  AGENT_NAME          : Display name shown in the chat UI
  AGENT_TONE          : "friendly" | "professional" | "motivational" | "clinical"
  DIET_SPECIALIZATION : "general" | "vegetarian" | "vegan" | "keto" | "diabetic"
                        | "ayurvedic" | "indian_regional"
  LANGUAGE_STYLE      : "simple" | "detailed" | "scientific"
  INCLUDE_INDIAN_FOOD : True  → always suggest Indian meal options first
  SAFETY_RULES        : List of hard rules the model must never violate
  CALORIE_DISCLAIMER  : Appended to every calorie / medical answer
  MAX_FAMILY_MEMBERS  : Maximum profiles allowed per session
  RESPONSE_LANGUAGE   : "english" | "hinglish" | "hindi"
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
# override=True ensures .env always wins over any stale system/shell env vars
load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), ".env"), override=True)

# ─────────────────────────────────────────────────────────────────────────────
# AGENT CONFIGURATION  (edit freely)
# ─────────────────────────────────────────────────────────────────────────────
AGENT_INSTRUCTIONS = {
    "AGENT_NAME": "NutriBot",
    "AGENT_TONE": "friendly",                # friendly | professional | motivational | clinical
    "DIET_SPECIALIZATION": "indian_regional", # general | vegetarian | vegan | keto | diabetic | ayurvedic | indian_regional
    "LANGUAGE_STYLE": "simple",              # simple | detailed | scientific
    "INCLUDE_INDIAN_FOOD": True,             # Always prioritize Indian food options
    "RESPONSE_LANGUAGE": "english",          # english | hinglish | hindi
    "MAX_FAMILY_MEMBERS": 8,

    # Hard safety rules injected into every system prompt
    "SAFETY_RULES": [
        "Never prescribe medication or replace a licensed dietitian.",
        "Always recommend consulting a doctor for medical conditions.",
        "Do not provide advice that promotes extreme caloric restriction (< 1000 kcal/day).",
        "Flag any query about eating disorders with a helpline suggestion.",
        "Keep all responses evidence-based and cite general nutritional guidelines.",
    ],

    # Appended to every calorie / medical response
    "CALORIE_DISCLAIMER": (
        "⚠️ These figures are estimates. Individual requirements vary. "
        "Please consult a registered dietitian for personalised medical nutrition therapy."
    ),

    # Extra personality / style directives
    "PERSONALITY": (
        "You are NutriBot, a warm, encouraging AI nutrition assistant specializing in "
        "Indian cuisine and Ayurvedic principles. You love suggesting dals, sabzis, "
        "millets, and regional Indian dishes. You balance modern nutritional science "
        "with traditional Indian food wisdom. Keep responses concise, practical, and "
        "culturally sensitive."
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

# Best available instruct model for the au-syd region
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

# Set to True once credentials are verified
_watsonx_ready = False

def init_watsonx():
    """Verify credentials by fetching an IAM token — no SDK, no CPD detection."""
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
    indian_note = (
        "Always suggest Indian food options first (dals, sabzis, rotis, millets, "
        "rice dishes, regional cuisines from across India)."
        if ai["INCLUDE_INDIAN_FOOD"] else ""
    )

    profile_block = ""
    if user_profile:
        profile_block = f"""
Current user profile:
  Name   : {user_profile.get('name', 'User')}
  Age    : {user_profile.get('age', 'N/A')}
  Gender : {user_profile.get('gender', 'N/A')}
  Weight : {user_profile.get('weight', 'N/A')} kg
  Height : {user_profile.get('height', 'N/A')} cm
  Goal   : {user_profile.get('goal', 'Healthy eating')}
  Diet   : {user_profile.get('diet_type', ai['DIET_SPECIALIZATION'])}
  Allergies: {user_profile.get('allergies', 'None')}
"""

    prompt = f"""{ai['PERSONALITY']}

Tone       : {ai['AGENT_TONE']}
Style      : {ai['LANGUAGE_STYLE']}
Language   : {ai['RESPONSE_LANGUAGE']}
Specialization: {ai['DIET_SPECIALIZATION']}
{indian_note}

Safety Rules (NEVER violate):
{rules}

{profile_block}

Format responses with:
- Clear headings using **bold**
- Bullet points for lists
- 🥗 food emojis where appropriate
- Practical, actionable advice
- Always end nutrition/calorie answers with: {ai['CALORIE_DISCLAIMER']}
"""
    return prompt.strip()


# ── AI generation helpers ─────────────────────────────────────────────────────

def generate_ai_response(user_message: str, user_profile: dict | None = None,
                          chat_history: list | None = None) -> str:
    """Call Watsonx.ai via direct REST — bypasses SDK CPD-detection entirely."""
    if not _watsonx_ready:
        return _demo_response(user_message)

    system_prompt = build_system_prompt(user_profile)

    # Build messages list (last 6 turns of history + current message)
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
    """Fallback response when Watsonx.ai is not configured."""
    msg = message.lower()
    if any(w in msg for w in ["calorie", "calories", "kcal"]):
        return ("**Calorie Estimation (Demo Mode)**\n\n"
                "• A typical Indian breakfast (poha / upma): ~250–350 kcal\n"
                "• Lunch (dal + roti + sabzi + rice): ~600–800 kcal\n"
                "• Dinner (khichdi / roti + dal): ~400–500 kcal\n\n"
                "🔧 *Configure IBM_API_KEY in .env to get personalised AI responses.*")
    if any(w in msg for w in ["meal", "plan", "diet"]):
        return ("**Sample Indian Meal Plan (Demo Mode)**\n\n"
                "🌅 **Breakfast**: Moong dal chilla + green chutney\n"
                "🌞 **Lunch**: Brown rice + rajma + mixed sabzi + salad\n"
                "🌆 **Snack**: Roasted chana + chai\n"
                "🌙 **Dinner**: Bajra roti + palak paneer + raita\n\n"
                "🔧 *Configure IBM_API_KEY in .env for personalised AI meal plans.*")
    return ("👋 Hi! I'm **NutriBot** (Demo Mode).\n\n"
            "I can help with:\n"
            "• Personalised meal plans 🍱\n"
            "• Calorie analysis 📊\n"
            "• BMI calculation ⚖️\n"
            "• Family nutrition profiles 👨‍👩‍👧‍👦\n\n"
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
        "sedentary": 1.2,
        "light": 1.375,
        "moderate": 1.55,
        "active": 1.725,
        "very_active": 1.9,
    }
    factor = multipliers.get(activity, 1.55)
    tdee = round(bmr * factor)
    return {
        "bmr": round(bmr),
        "tdee": tdee,
        "weight_loss": tdee - 500,
        "weight_gain": tdee + 300,
    }


def calculate_macros(tdee: int, goal: str) -> dict:
    """Return gram targets for protein, carbs, fat."""
    targets = {
        "weight_loss":    {"protein": 0.35, "carbs": 0.35, "fat": 0.30},
        "weight_gain":    {"protein": 0.30, "carbs": 0.45, "fat": 0.25},
        "muscle_gain":    {"protein": 0.40, "carbs": 0.40, "fat": 0.20},
        "maintenance":    {"protein": 0.25, "carbs": 0.50, "fat": 0.25},
        "healthy_eating": {"protein": 0.25, "carbs": 0.50, "fat": 0.25},
    }
    ratios = targets.get(goal.lower().replace(" ", "_"), targets["maintenance"])
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
    user_message  = data.get("message", "").strip()
    user_profile  = data.get("profile")
    chat_history  = data.get("history", [])

    if not user_message:
        return jsonify({"error": "Message is required"}), 400

    logger.info("Chat request: %s…", user_message[:60])
    response = generate_ai_response(user_message, user_profile, chat_history)
    return jsonify({
        "response": response,
        "timestamp": datetime.now().strftime("%H:%M"),
        "agent": AGENT_INSTRUCTIONS["AGENT_NAME"],
    })


@app.route("/api/bmi", methods=["POST"])
def bmi_endpoint():
    data = request.get_json(silent=True) or {}
    try:
        weight = float(data["weight"])
        height = float(data["height"])
        age    = int(data.get("age", 30))
        gender = data.get("gender", "male")
        activity = data.get("activity", "moderate")
        goal   = data.get("goal", "maintenance")
    except (KeyError, ValueError) as exc:
        return jsonify({"error": f"Invalid input: {exc}"}), 400

    bmi_result  = calculate_bmi(weight, height)
    tdee_result = calculate_tdee(weight, height, age, gender, activity)
    macros      = calculate_macros(tdee_result["tdee"], goal)

    return jsonify({**bmi_result, **tdee_result, **macros})


@app.route("/api/meal-plan", methods=["POST"])
def meal_plan():
    data    = request.get_json(silent=True) or {}
    profile = data.get("profile", {})
    days    = min(int(data.get("days", 7)), 7)

    prompt = (
        f"Generate a detailed {days}-day Indian meal plan for:\n"
        f"Goal: {profile.get('goal', 'healthy eating')}\n"
        f"Diet: {profile.get('diet_type', 'vegetarian')}\n"
        f"Calories/day: {profile.get('calories', 2000)} kcal\n"
        f"Allergies: {profile.get('allergies', 'none')}\n\n"
        "Format: Day-wise table with Breakfast, Lunch, Snack, Dinner. "
        "Include calorie estimates and key nutrients. "
        "Suggest traditional Indian dishes with modern healthy twists."
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
        "3. Glycemic index (if applicable)\n"
        "4. Health benefits\n"
        "5. Best time to consume\n"
        "6. Healthy Indian recipe ideas using this ingredient\n"
        "Keep it concise and practical."
    )

    response = generate_ai_response(prompt)
    return jsonify({"analysis": response, "food": food_item, "quantity": quantity})


@app.route("/api/family-plan", methods=["POST"])
def family_plan():
    data    = request.get_json(silent=True) or {}
    members = data.get("members", [])

    if not members:
        return jsonify({"error": "Family members required"}), 400
    if len(members) > AGENT_INSTRUCTIONS["MAX_FAMILY_MEMBERS"]:
        return jsonify({"error": f"Maximum {AGENT_INSTRUCTIONS['MAX_FAMILY_MEMBERS']} members allowed"}), 400

    member_details = "\n".join(
        f"  • {m.get('name', 'Member')} (Age {m.get('age')}, {m.get('gender')}, Goal: {m.get('goal', 'healthy eating')})"
        for m in members
    )

    prompt = (
        f"Create a unified family meal plan that works for all these members:\n"
        f"{member_details}\n\n"
        "Requirements:\n"
        "1. One common meal plan that can be adapted for each member\n"
        "2. Highlight modifications needed per member\n"
        "3. Focus on Indian home-cooked meals\n"
        "4. Consider all age groups and dietary needs\n"
        "5. Include shopping list for the week\n"
        "6. Budget-friendly suggestions"
    )

    response = generate_ai_response(prompt)
    return jsonify({"plan": response, "members": len(members)})


@app.route("/api/health-check", methods=["GET"])
def health_check():
    return jsonify({
        "status": "running",
        "agent": AGENT_INSTRUCTIONS["AGENT_NAME"],
        "watsonx_connected": _watsonx_ready,
        "diet_specialization": AGENT_INSTRUCTIONS["DIET_SPECIALIZATION"],
        "timestamp": datetime.now().isoformat(),
    })


@app.route("/api/agent-config", methods=["GET"])
def agent_config():
    """Return safe (non-sensitive) agent configuration for the UI."""
    safe_keys = ["AGENT_NAME", "AGENT_TONE", "DIET_SPECIALIZATION",
                 "LANGUAGE_STYLE", "INCLUDE_INDIAN_FOOD", "RESPONSE_LANGUAGE",
                 "MAX_FAMILY_MEMBERS", "PERSONALITY"]
    return jsonify({k: AGENT_INSTRUCTIONS[k] for k in safe_keys})


# ── Initialise Watsonx on startup (runs whether started via __main__ or gunicorn)
init_watsonx()

# ── Entry point ───────────────────────────────────────────────────────────────
if __name__ == "__main__":
    port  = int(os.getenv("PORT", 5000))
    debug = os.getenv("FLASK_DEBUG", "false").lower() == "true"
    logger.info("Nutrition Agent starting on http://0.0.0.0:%d", port)
    app.run(host="0.0.0.0", port=port, debug=debug)
