# 💪 Fitness Buddy — AI Fitness Coach

> **IBM Hackathon · Problem Statement #13 — Fitness Buddy**
> Built with **IBM Watsonx.ai** (Llama 3.3 70B Instruct) · IBM Cloud Lite

---

## 🎯 Problem Statement

In today's fast-paced world, many individuals struggle to maintain a healthy lifestyle due to lack of personalised guidance, time constraints, and inconsistent motivation. Traditional fitness solutions often require expensive subscriptions, in-person consultations, or rigid schedules.

**Fitness Buddy** solves this by offering a conversational, AI-powered health and fitness coach available 24/7 — free and accessible to everyone.

---

## ✨ Features

| Feature | Description |
|---|---|
| 🤖 **AI Fitness Coach** | Conversational chat for instant workout advice, Q&A, and personalised guidance |
| 🏋️ **Workout Planner** | AI-generated home workout routines by fitness level, duration, focus area & equipment |
| 🌟 **Daily Motivation** | AI-powered motivational quotes and actionable fitness tips refreshed on demand |
| 🥗 **Nutrition Planner** | Personalised meal plans + food nutritional analysis optimised for fitness goals |
| 📅 **Habit Builder** | 30-day habit-building plans tailored to your fitness level and goals |
| ⚖️ **BMI & Calorie Calculator** | BMR, TDEE, macro targets, weight-loss/gain calorie goals |
| 🌙 **Dark Mode** | Full dark/light theme toggle |
| 📱 **Responsive** | Works on mobile, tablet, and desktop |

---

## 🛠️ Technology Stack

| Layer | Technology |
|---|---|
| **AI Model** | IBM Watsonx.ai — Llama 3.3 70B Instruct (`meta-llama/llama-3-3-70b-instruct`) |
| **AI Platform** | IBM Cloud (Lite tier) — Watsonx.ai |
| **Backend** | Python 3.11+ · Flask 3.0 · Gunicorn |
| **Frontend** | HTML5 · CSS3 · Vanilla JS · Bootstrap 5 · Bootstrap Icons |
| **Auth** | IBM Cloud IAM (API Key) |

---

## 🚀 Quick Start

### 1. Clone & Install

```bash
git clone https://github.com/YOUR_USERNAME/Nutrition-Agent.git
cd Nutrition-Agent
python -m venv .venv
.venv\Scripts\activate        # Windows
# source .venv/bin/activate   # macOS / Linux
pip install -r requirements.txt
```

### 2. Configure Environment

```bash
copy .env.example .env        # Windows
# cp .env.example .env        # macOS / Linux
```

Edit `.env` and fill in:

```env
IBM_API_KEY=your_ibm_cloud_api_key
IBM_PROJECT_ID=your_watsonx_project_id
IBM_URL=https://us-south.ml.cloud.ibm.com
FLASK_SECRET_KEY=change_this_to_a_long_random_string
```

Get your credentials:
- **API Key** → [cloud.ibm.com/iam/apikeys](https://cloud.ibm.com/iam/apikeys)
- **Project ID** → [dataplatform.cloud.ibm.com](https://dataplatform.cloud.ibm.com) → Your Project → Manage → General

### 3. Run

```bash
python app.py
```

Open **http://localhost:5000** in your browser.

---

## 📂 Project Structure

```
Fitness Buddy/
├── app.py                   # Flask backend + IBM Watsonx.ai integration
├── requirements.txt         # Python dependencies
├── .env.example             # Environment variable template
├── .gitignore
├── templates/
│   └── index.html           # SPA frontend (6 tabs)
└── static/
    ├── css/style.css        # Custom styles (dark mode, responsive)
    └── js/app.js            # Frontend logic
```

---

## 🔌 API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/chat` | AI fitness coaching chat |
| `POST` | `/api/workout` | Generate personalised workout routine |
| `GET` | `/api/motivation` | Get daily motivational message |
| `POST` | `/api/meal-plan` | Generate fitness meal plan |
| `POST` | `/api/analyze-food` | Nutritional analysis of any food |
| `POST` | `/api/habits` | Generate 30-day habit-building plan |
| `POST` | `/api/bmi` | BMI, TDEE, and macro calculation |
| `GET` | `/api/health-check` | Service status |

---

## ☁️ Deploying to the Cloud

### Render (Free)

1. Push to GitHub
2. Go to [render.com](https://render.com) → New Web Service → Connect repo
3. **Build Command:** `pip install -r requirements.txt`
4. **Start Command:** `gunicorn app:app`
5. Add environment variables in Render dashboard

### Railway / Heroku

The project includes `gunicorn` in `requirements.txt` and is production-ready.

---

## ⚠️ Disclaimer

Fitness Buddy is an AI assistant for general wellness guidance only. It is **not a substitute** for professional medical advice, diagnosis, or treatment. Always consult a qualified healthcare provider before starting a new exercise program.

---

## 📄 License

MIT — Free to use, modify, and distribute.

---

<p align="center">Built with ❤️ using <strong>IBM Watsonx.ai</strong> · IBM Cloud Lite</p>
